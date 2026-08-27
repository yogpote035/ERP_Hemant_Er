/**
 * Invoices module (RBAC key: "billing") — port of the frontend billing commands
 * + invoice selectors onto the backend foundation.
 *
 *   GET  /            list invoices with computed grand + outstanding (scoped, optional ?date=)
 *   GET  /:id         one invoice (raw entity)
 *   GET  /:id/doc     full client-format invoice document (domain/invoiceCompute)
 *   POST /finalize    freeze a draft into a legal invoice (mint per-(issuer,FY) seq, snapshot)
 *   POST /:id/void    void an issued invoice
 *
 * Unlike the in-browser store (where the typed Bill No IS the invoice number), the
 * server MINTS the invoice number on finalize from a per-(issuer, FY) sequence in
 * `system.sequences` keyed `${issuerId}:${fy}`, formatting it through the issuer's
 * `invoiceFormat`/`seqPad`. The frozen totals/taxKind/packing/party/line snapshots
 * make the issued document legally immutable.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { patchEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound, conflict } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { todayISO } from '../../lib/id.js'
import { fyOf, seqKey } from '../../lib/fy.js'
import type { Paise } from '../../lib/money.js'
import type { Id, Invoice, InvoicePartySnapshot } from '../../types/domain.js'
import type { RootState } from '../../db/state.js'
import {
  computeInvoice,
  deriveTaxKind,
  selectInvoiceLines,
  selectInvoiceDocModel,
} from '../../domain/invoiceCompute.js'
import {
  invoiceGrand,
  invoicePaymentStatus,
  outstandingForInvoice,
  paidForInvoice,
} from '../../domain/billing.js'
import { buildList, cursorList } from '../../lib/list.js'

const MODULE = 'billing' as const

export const invoicesRouter = Router()
invoicesRouter.use(authenticate)

/** Scope set from req.auth (null ⇒ all units, no scoping). */
function scopeOf(req: Request): Set<Id> | null {
  const allowed = req.auth?.allowedUnitIds
  return allowed == null ? null : new Set(allowed)
}

// ── GET / (list with computed totals + outstanding) ──────────────────────────────
invoicesRouter.get(
  '/',
  requirePermission(MODULE, 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const allowed = scopeOf(req)
    const { date, from, to, status, lifecycle } = req.query as { date?: string; from?: string; to?: string; status?: string; lifecycle?: string }
    let rows = values(s.billing.invoices)
      .filter((inv) => !allowed || allowed.has(inv.unitId))
      .filter((inv) => !date || inv.invoiceDate === date)
      .filter((inv) => !from || (inv.invoiceDate ?? '') >= from)
      .filter((inv) => !to || (inv.invoiceDate ?? '') <= to)
      .filter((inv) => !lifecycle || inv.lifecycle === lifecycle)
      .map((inv) => {
        const isDraft = inv.lifecycle === 'draft'
        const grand = isDraft ? computeInvoice(s, inv, 'igst').totals.grand : invoiceGrand(inv)
        return {
          invoice: inv,
          customerName:
            inv.partySnapshot?.custName ||
            getById(s.masters.customers, inv.customerId)?.name ||
            '— unassigned —',
          status: invoicePaymentStatus(s, inv),
          grand,
          outstanding: outstandingForInvoice(s, inv),
          lineCount: selectInvoiceLines(s, inv).length,
        }
      })
      .sort((a, b) => (b.invoice.invoiceDate ?? '').localeCompare(a.invoice.invoiceDate ?? ''))
    if (status) rows = rows.filter((r) => r.status === status)
    const searchText = (r: (typeof rows)[number]) => `${r.invoice.billNo} ${r.customerName}`
    if (req.query.mode === 'cursor') {
      res.json(cursorList(rows, req.query, { idOf: (r) => r.invoice.id, searchText }))
    } else {
      res.json(buildList(rows, req.query, searchText))
    }
  })
)

// ── GET /:id ─────────────────────────────────────────────────────────────────────
invoicesRouter.get(
  '/:id',
  requirePermission(MODULE, 'view'),
  asyncHandler(async (req, res) => {
    const inv = getById(getDb().billing.invoices, req.params.id)
    if (!inv) throw notFound('Invoice not found')
    assertUnit(req, inv.unitId)
    res.json({ data: inv })
  })
)

// ── GET /:id/doc (client-format invoice document) ────────────────────────────────
invoicesRouter.get(
  '/:id/doc',
  requirePermission(MODULE, 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const inv = getById(s.billing.invoices, req.params.id)
    if (!inv) throw notFound('Invoice not found')
    assertUnit(req, inv.unitId)
    const doc = selectInvoiceDocModel(s, req.params.id)
    if (!doc) throw notFound('Invoice not found')
    res.json({ data: doc })
  })
)

// ── POST /finalize ───────────────────────────────────────────────────────────────
// Reject an unparseable date at the boundary (400) instead of letting `new Date(bad)`
// throw a RangeError deeper in addDaysISO (→ 500).
const isoDate = z.string().refine((v) => !Number.isNaN(Date.parse(v)), 'Invalid date')
// Optional dispatch / transport details shown on the GST invoice.
const dispatchMetaShape = {
  ewayBillNo: z.string().optional(),
  vehicleNo: z.string().optional(),
  transporter: z.string().optional(),
  dispatchedThrough: z.string().optional(),
  destination: z.string().optional(),
}
const dispatchMeta = (b: Record<string, unknown>) => ({
  ewayBillNo: (b.ewayBillNo as string)?.trim() || undefined,
  vehicleNo: (b.vehicleNo as string)?.trim() || undefined,
  transporter: (b.transporter as string)?.trim() || undefined,
  dispatchedThrough: (b.dispatchedThrough as string)?.trim() || undefined,
  destination: (b.destination as string)?.trim() || undefined,
})
const finalizeSchema = z.object({
  invoiceId: z.string().min(1),
  customerId: z.string().min(1),
  issuerKind: z.enum(['unit', 'supplier']),
  issuerVendorId: z.string().optional(),
  invoiceDate: isoDate.optional(),
  paymentTerms: z.string().optional(),
  ...dispatchMetaShape,
})

/** Issuer state code: supplier vendor's, else the invoice's unit. */
function issuerStateOf(s: RootState, inv: Invoice, issuerKind: string, issuerVendorId?: string): string | undefined {
  if (issuerKind === 'supplier') return getById(s.masters.vendors, issuerVendorId)?.stateCode
  return getById(s.masters.units, inv.unitId)?.stateCode
}

/** Render a minted seq + FY into the issuer's invoiceFormat (`{seq}` / `{FY}` tokens). */
function formatBillNo(format: string, seqPad: number, seq: number, fy: string): string {
  const seqStr = String(seq).padStart(Math.max(0, seqPad), '0')
  return format.replace(/\{seq\}/g, seqStr).replace(/\{FY\}/gi, fy)
}

/** Add `days` to an ISO date, returning `yyyy-MM-dd`. Defensive: a bad date returns
 *  the original string rather than throwing (the schema already rejects bad input). */
function addDaysISO(iso: string, days: number): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso.slice(0, 10)
  d.setDate(d.getDate() + days)
  return d.toISOString().slice(0, 10)
}

invoicesRouter.post(
  '/finalize',
  requirePermission(MODULE, 'edit'),
  asyncHandler(async (req, res) => {
    const input = finalizeSchema.parse(req.body)
    const s = getDb()

    const inv = getById(s.billing.invoices, input.invoiceId)
    if (!inv) throw notFound('Invoice not found')
    assertUnit(req, inv.unitId)
    if (inv.lifecycle !== 'draft') throw conflict(`Bill ${inv.billNo} is already ${inv.lifecycle}`)

    const cust = getById(s.masters.customers, input.customerId)
    if (!cust) throw badRequest('Choose a consignee (customer)')

    if (input.issuerKind === 'supplier') {
      const v = getById(s.masters.vendors, input.issuerVendorId)
      if (!v) throw badRequest('Choose the issuing RM supplier')
      if (!v.gstin || !v.stateCode) throw badRequest('The issuing supplier needs a GSTIN + state code')
    }

    // Must have at least one billed dispatch line to invoice.
    if (computeInvoice(s, inv, 'igst').lines.length === 0) {
      throw badRequest('This bill has no billed dispatch lines to invoice')
    }

    const result = await mutate((draft) => {
      const d = getById(draft.billing.invoices, input.invoiceId) as Invoice
      const c = getById(draft.masters.customers, input.customerId)
      const issuerState = issuerStateOf(draft, d, input.issuerKind, input.issuerVendorId)
      const taxKind = deriveTaxKind(issuerState, c?.stateCode)
      const { totals, packing, lines } = computeInvoice(draft, d, taxKind)

      const invoiceDate = input.invoiceDate || d.invoiceDate || todayISO()
      const fy = fyOf(invoiceDate)
      const terms = c?.paymentTermsDays
      const dueDate = terms != null ? addDaysISO(invoiceDate, terms) : undefined
      const issuerId =
        input.issuerKind === 'supplier' && input.issuerVendorId ? input.issuerVendorId : d.unitId

      // Mint the next per-(issuer, FY) invoice number and format the Bill No.
      const key = seqKey(issuerId, fy)
      const seq = (draft.system.sequences[key] ?? 0) + 1
      draft.system.sequences[key] = seq
      const issuerVendor = input.issuerKind === 'supplier' ? getById(draft.masters.vendors, issuerId) : undefined
      const issuerUnit = getById(draft.masters.units, d.unitId)
      const format = issuerVendor?.invoiceFormat ?? issuerUnit?.invoiceFormat ?? '{seq}/{FY}'
      const seqPad = issuerUnit?.seqPad ?? 0
      const billNo = formatBillNo(format, seqPad, seq, fy)

      // Freeze issuer + consignee + line identity now (legal immutability).
      const partySnapshot: InvoicePartySnapshot = {
        custName: c?.name ?? '',
        custGstin: c?.gstin ?? '',
        custStateCode: c?.stateCode ?? '',
        custAddress: c?.addressLines ?? [],
        issuerName: issuerVendor?.name ?? issuerUnit?.name ?? '',
        issuerGstin: issuerVendor?.gstin ?? issuerUnit?.gstin ?? '',
        issuerStateCode: (issuerVendor?.stateCode ?? issuerUnit?.stateCode) ?? '',
        issuerAddress: issuerVendor?.addressLines ?? issuerUnit?.addressLines ?? [],
      }

      patchEntity(draft.billing.invoices, d.id, {
        customerId: input.customerId,
        issuerKind: input.issuerKind,
        issuerId,
        billNo,
        fy,
        seq,
        invoiceDate,
        dueDate,
        paymentTerms: input.paymentTerms,
        ...dispatchMeta(input),
        taxKind,
        totals,
        packing,
        partySnapshot,
        lineSnapshot: lines,
        lifecycle: 'sent',
      })

      const taxLabel = taxKind === 'igst' ? 'IGST' : 'CGST+SGST'
      const updated = getById(draft.billing.invoices, d.id) as Invoice
      return {
        invoice: updated,
        cascade: [
          `Bill ${billNo} issued to ${c?.name ?? 'customer'}`,
          `${taxLabel} · grand ${totals.grand}`,
          dueDate ? `due ${dueDate}` : 'no due date',
        ],
      }
    })

    res.status(201).json({ data: result.invoice, cascade: result.cascade })
  })
)

// ── POST /:id/void ───────────────────────────────────────────────────────────────
invoicesRouter.post(
  '/:id/void',
  requirePermission(MODULE, 'edit'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const inv = getById(s.billing.invoices, req.params.id)
    if (!inv) throw notFound('Invoice not found')
    assertUnit(req, inv.unitId)
    if (inv.lifecycle !== 'sent') throw conflict('Only an issued invoice can be voided')
    if (paidForInvoice(s, inv.id) > (0 as Paise)) throw conflict('Reverse its payments before voiding')

    const updated = await mutate((draft) => {
      patchEntity(draft.billing.invoices, inv.id, { lifecycle: 'void' })
      return getById(draft.billing.invoices, inv.id) as Invoice
    })

    res.json({
      data: updated,
      cascade: [`Bill ${inv.billNo} voided`, 'no longer counts toward receivables'],
    })
  })
)

// ── POST /:id/edit-draft ──────────────────────────────────────────────────────────
// Edit a DRAFT invoice's header (consignee, issuer, date, terms) before it's issued.
// Issued/void invoices are immutable legal documents, so this rejects non-drafts.
const editDraftSchema = z.object({
  customerId: z.string().optional(),
  issuerKind: z.enum(['unit', 'supplier']),
  issuerVendorId: z.string().optional(),
  invoiceDate: isoDate.optional(),
  paymentTerms: z.string().optional(),
  ...dispatchMetaShape,
})
invoicesRouter.post(
  '/:id/edit-draft',
  requirePermission(MODULE, 'edit'),
  asyncHandler(async (req, res) => {
    const input = editDraftSchema.parse(req.body)
    const s = getDb()
    const inv = getById(s.billing.invoices, req.params.id)
    if (!inv) throw notFound('Invoice not found')
    assertUnit(req, inv.unitId)
    if (inv.lifecycle !== 'draft') throw conflict(`Bill ${inv.billNo} is ${inv.lifecycle} — only a draft can be edited`)
    if (input.issuerKind === 'supplier') {
      const v = getById(s.masters.vendors, input.issuerVendorId)
      if (!v || !v.gstin || !v.stateCode) throw badRequest('The issuing supplier needs a GSTIN + state code')
    }
    const issuerId = input.issuerKind === 'supplier' && input.issuerVendorId ? input.issuerVendorId : inv.unitId
    const updated = await mutate((draft) => {
      patchEntity(draft.billing.invoices, inv.id, {
        customerId: input.customerId || undefined,
        issuerKind: input.issuerKind,
        issuerId,
        invoiceDate: input.invoiceDate || inv.invoiceDate,
        paymentTerms: input.paymentTerms,
        ...dispatchMeta(input),
      })
      return getById(draft.billing.invoices, inv.id) as Invoice
    })
    res.json({ data: updated, cascade: [`Draft ${inv.billNo} updated`] })
  })
)
