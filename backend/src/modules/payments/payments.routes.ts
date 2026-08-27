/**
 * Payments module — record (possibly multi-bill) receipts against issued
 * invoices, list them, list open invoices with outstanding, and reverse a
 * receipt. Ported from frontend src/store/billingCommands.ts
 * (runRecordPayment / runReversePayment) + src/selectors/billing.ts
 * (outstandingForInvoice / paidForInvoice).
 *
 * Money fields are integer PAISE. Payment status / outstanding stay DERIVED —
 * recording or reversing a payment only writes the Payment row; the invoice's
 * outstanding is recomputed from allocations on read.
 *
 * Session scope (writableUnitIds / allowedUnitIds) is replaced by the route-layer
 * req.auth scope: assertUnit before writing a row for a unit, and filter lists to
 * req.auth.allowedUnitIds (null = all units).
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound, forbidden } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit, canAccessUnit } from '../../auth/middleware.js'
import { resolveId } from '../../lib/id.js'
import { addP, type Paise } from '../../lib/money.js'
import { outstandingForInvoice } from '../../domain/billing.js'
import { buildList, cursorList } from '../../lib/list.js'
import type { Id, Invoice, Payment, PaymentAllocation, PaymentMode } from '../../types/domain.js'
import type { RootState } from '../../db/state.js'

const ZERO = 0 as Paise

// ── schemas ──────────────────────────────────────────────────────────────────
const allocationSchema = z.object({
  invoiceId: z.string().min(1),
  amountPaise: z.number().int(),
})

const recordPaymentSchema = z.object({
  id: z.string().optional(),
  mode: z.enum(['cash', 'cheque', 'rtgs', 'neft', 'upi', 'bank']),
  ref: z.string().default(''),
  date: z.string().min(1),
  amountPaise: z.number().int(),
  allocations: z.array(allocationSchema).min(1, 'Allocate the payment to at least one bill'),
})

// ── helpers ──────────────────────────────────────────────────────────────────
/** Units the caller may read (null = all). */
function allowedSet(req: Request): Set<Id> | null {
  const ids = req.auth?.allowedUnitIds
  return ids == null ? null : new Set(ids)
}

/** Total received against one invoice across every payment's allocations (DERIVED). */
function paidForInvoice(s: RootState, invoiceId: Id): Paise {
  let paid = ZERO
  for (const p of values(s.payments.payments)) {
    for (const a of p.allocations) {
      if (a.invoiceId === invoiceId) paid = addP(paid, a.amountPaise)
    }
  }
  return paid
}

// ── router ───────────────────────────────────────────────────────────────────
export const paymentsRouter = Router()
paymentsRouter.use(authenticate)

/**
 * GET / — list payments. A payment is scoped through the unit of the invoices it
 * allocates to; show only payments touching a unit the caller may read.
 */
paymentsRouter.get(
  '/',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const allowed = allowedSet(req)
    const rows = values(s.payments.payments).filter((p) => {
      if (allowed == null) return true
      // visible if any allocated invoice's unit is in scope
      return p.allocations.some((a) => {
        const inv = getById(s.billing.invoices, a.invoiceId)
        return inv ? allowed.has(inv.unitId) : false
      })
    })
    // Search also covers the allocated bills + their customers (the columns a user sees).
    const searchText = (r: (typeof rows)[number]) => {
      const bills = r.allocations
        .map((a) => {
          const inv = getById(s.billing.invoices, a.invoiceId)
          const cust = inv ? getById(s.masters.customers, inv.customerId) : undefined
          return `${inv?.billNo ?? ''} ${cust?.name ?? ''}`
        })
        .join(' ')
      return `${r.ref} ${r.mode} ${bills}`
    }
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/**
 * GET /outstanding — issued invoices with outstanding > 0, scoped to readable
 * units. Each row carries the derived grand / paid / outstanding for the
 * payments screen to allocate against.
 */
paymentsRouter.get(
  '/outstanding',
  requirePermission('payments', 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const allowed = allowedSet(req)
    const rows = values(s.billing.invoices)
      .filter((inv) => inv.lifecycle === 'sent')
      .filter((inv) => allowed == null || allowed.has(inv.unitId))
      .map((inv) => {
        const grand = inv.totals?.grand ?? ZERO
        const paid = paidForInvoice(s, inv.id)
        const outstanding = outstandingForInvoice(s, inv)
        return {
          id: inv.id,
          billNo: inv.billNo,
          unitId: inv.unitId,
          customerId: inv.customerId,
          invoiceDate: inv.invoiceDate,
          dueDate: inv.dueDate,
          grandPaise: grand,
          paidPaise: paid,
          outstandingPaise: outstanding,
        }
      })
      .filter((r) => r.outstandingPaise > 0)
    res.json({ data: rows })
  })
)

/**
 * POST / — record a (possibly multi-bill) receipt.
 * Validation ported from validatePayment: amount > 0, ≥1 allocation, each target
 * invoice exists + is issued ('sent') + in writable scope, each allocation > 0,
 * the TOTAL allocated to each invoice (folding duplicate allocations) ≤ that
 * invoice's outstanding, and total allocated ≤ the payment amount.
 */
paymentsRouter.post(
  '/',
  requirePermission('payments', 'create'),
  asyncHandler(async (req, res) => {
    const input = recordPaymentSchema.parse(req.body)
    const s = getDb()

    if (!(input.amountPaise > 0)) throw badRequest('Amount must be greater than zero')

    let allocated = ZERO
    const perInvoice = new Map<Id, Paise>()
    for (const a of input.allocations) {
      const inv = getById(s.billing.invoices, a.invoiceId)
      if (!inv) throw badRequest('Allocation targets a missing invoice')
      if (inv.lifecycle !== 'sent') throw badRequest(`Bill ${inv.billNo} is not issued — can't receive payment`)
      if (!canAccessUnit(req, inv.unitId)) throw forbidden(`No access to bill ${inv.billNo}'s unit`)
      if (!(a.amountPaise > 0)) throw badRequest(`Allocation to ${inv.billNo} must be positive`)
      perInvoice.set(a.invoiceId, addP(perInvoice.get(a.invoiceId) ?? ZERO, a.amountPaise as Paise))
      allocated = addP(allocated, a.amountPaise as Paise)
    }
    // Cap the TOTAL allocated to each invoice at its outstanding — a per-allocation
    // check alone lets two lines overpay one bill.
    for (const [invId, sum] of perInvoice) {
      const inv = getById(s.billing.invoices, invId) as Invoice
      const out = outstandingForInvoice(s, inv)
      if (sum > out) throw badRequest(`Allocation to ${inv.billNo} exceeds its ${out} outstanding`)
    }
    if (allocated > (input.amountPaise as Paise)) throw badRequest('Allocated more than the payment amount')

    const allocations: PaymentAllocation[] = input.allocations.map((a) => ({
      invoiceId: a.invoiceId,
      amountPaise: a.amountPaise as Paise,
    }))
    const payment: Payment = {
      id: resolveId(input.id, (id) => !!getById(s.payments.payments, id), 'pay'),
      mode: input.mode as PaymentMode,
      ref: input.ref,
      date: input.date,
      amountPaise: input.amountPaise as Paise,
      allocations,
    }

    await mutate((draft) => putEntity(draft.payments.payments, payment))

    const bills = allocations
      .map((a) => getById(s.billing.invoices, a.invoiceId)?.billNo)
      .filter((b): b is string => Boolean(b))
    res.status(201).json({
      data: payment,
      cascade: [
        `${input.amountPaise} received (${input.mode.toUpperCase()})`,
        `allocated to ${bills.length} bill${bills.length === 1 ? '' : 's'}: ${bills.join(', ')}`,
      ],
    })
  })
)

/**
 * POST /:id/reverse — reverse (delete) a recorded receipt. Removing the payment
 * restores the allocated invoices' outstanding (derived), so a mistakenly-"paid"
 * invoice can then be voided/edited. Ported from reversePaymentCmd.
 */
paymentsRouter.post(
  '/:id/reverse',
  requirePermission('payments', 'delete'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const p = getById(s.payments.payments, req.params.id)
    if (!p) throw notFound('Payment not found')
    const unitId = getById(s.billing.invoices, p.allocations[0]?.invoiceId ?? '')?.unitId
    if (unitId) assertUnit(req, unitId)

    const bills = p.allocations
      .map((a) => getById(s.billing.invoices, a.invoiceId)?.billNo)
      .filter((b): b is string => Boolean(b))

    await mutate((draft) => removeEntity(draft.payments.payments, p.id))

    res.json({
      data: { id: p.id },
      cascade: [
        `Payment ${p.amountPaise} (${p.mode.toUpperCase()}) reversed`,
        bills.length ? `outstanding restored on ${bills.join(', ')}` : 'outstanding restored',
      ],
    })
  })
)
