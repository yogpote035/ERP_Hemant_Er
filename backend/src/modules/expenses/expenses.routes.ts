/**
 * Expenses module — overhead expenses with multi-instalment payments.
 * Ported from frontend src/store/expenseCommands.ts (saveExpense /
 * recordExpensePayment / deleteExpense). Balance + status stay DERIVED
 * (domain/finance.ts: expensePaid / expenseBalance / expenseStatus) — the store
 * holds the total and the instalment list only; paid/balance/status are computed
 * on read.
 *
 * Money fields are integer PAISE. Session scope (writableUnitIds) is replaced by
 * the route-layer req.auth scope: assertUnit before writing a row for a unit, and
 * filter list results to req.auth.allowedUnitIds (null = all units).
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity, patchEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { resolveId, nowISO } from '../../lib/id.js'
import { addP, type Paise } from '../../lib/money.js'
import { expensePaid, expenseBalance, expenseStatus } from '../../domain/finance.js'
import { buildList, cursorList } from '../../lib/list.js'
import type { Id, Expense, ExpenseInstalment, PaymentMode } from '../../types/domain.js'

const PAYMENT_MODES = ['cash', 'cheque', 'rtgs', 'neft', 'upi', 'bank'] as const

// ── schemas ──────────────────────────────────────────────────────────────────
const instalmentSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amountPaise: z.number().int().positive('Amount must be greater than 0'),
  mode: z.enum(PAYMENT_MODES),
  ref: z.string().optional(),
})

const createExpenseSchema = z.object({
  id: z.string().optional(),
  unitId: z.string().min(1),
  vendorId: z.string().min(1).optional(),
  vendorName: z.string().optional(),
  category: z.string().min(1, 'Description is required'),
  description: z.string().optional(),
  date: z.string().min(1, 'Date is required'),
  dueDate: z.string().optional(),
  hsnSac: z.string().optional(),
  quantity: z.number().nonnegative().optional(),
  ratePaise: z.number().int().nonnegative().optional(),
  subTotalPaise: z.number().int().nonnegative().optional(),
  igstPct: z.number().min(0).max(100).optional(),
  cgstPct: z.number().min(0).max(100).optional(),
  sgstPct: z.number().min(0).max(100).optional(),
  tcsPct: z.number().min(0).max(100).optional(),
  supplierInvoiceNo: z.string().optional(),
  totalPaise: z.number().int(),
  instalments: z.array(instalmentSchema).optional(),
})

/** New optional line-item + GST fields, mapped straight through to the stored Expense. */
function lineItemFields(input: z.infer<typeof createExpenseSchema>) {
  return {
    hsnSac: input.hsnSac,
    quantity: input.quantity,
    ratePaise: input.ratePaise as Paise | undefined,
    subTotalPaise: input.subTotalPaise as Paise | undefined,
    igstPct: input.igstPct,
    cgstPct: input.cgstPct,
    sgstPct: input.sgstPct,
    tcsPct: input.tcsPct,
    supplierInvoiceNo: input.supplierInvoiceNo,
  }
}

const payExpenseSchema = z.object({
  date: z.string().min(1, 'Date is required'),
  amountPaise: z.number().int(),
  mode: z.enum(PAYMENT_MODES),
  ref: z.string().optional(),
})

// ── helpers ──────────────────────────────────────────────────────────────────
/** Units the caller may read (null = all). */
function allowedSet(req: Request): Set<Id> | null {
  const ids = req.auth?.allowedUnitIds
  return ids == null ? null : new Set(ids)
}

/** Serialize an expense with its DERIVED paid / balance / status for the wire. */
function toRow(e: Expense, vendorName: string) {
  return {
    ...e,
    vendorName,
    paidPaise: expensePaid(e),
    balancePaise: expenseBalance(e),
    status: expenseStatus(e),
  }
}

function validateVendorUnit(s: ReturnType<typeof getDb>, vendorId: string | undefined, unitId: string) {
  if (!vendorId) return
  const vendor = getById(s.masters.vendors, vendorId)
  if (!vendor || !vendor.active) throw badRequest('Unknown or inactive vendor')
  if (vendor.unitId && vendor.unitId !== unitId) throw badRequest('Vendor does not belong to the selected unit')
  if (!vendor.unitId) {
    const usedInUnit = values(s.expenses.expenses).some((e) => e.unitId === unitId && e.vendorId === vendorId) ||
      values(s.inventory.inwards).some((i) => i.unitId === unitId && i.vendorId === vendorId)
    if (!usedInUnit) throw badRequest('Assign this vendor to the selected unit in Vendor Management first')
  }
}

// ── router ───────────────────────────────────────────────────────────────────
export const expensesRouter = Router()
expensesRouter.use(authenticate)

/**
 * GET / — list expenses, scoped to readable units, newest-first. Each row carries
 * the derived paid / balance / status (selectExpenseRows in the frontend).
 */
expensesRouter.get(
  '/',
  requirePermission('expenses', 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const allowed = allowedSet(req)
    const rows = values(s.expenses.expenses)
      .filter((e) => allowed == null || allowed.has(e.unitId))
      .map((e) => toRow(e, e.vendorName ?? getById(s.masters.vendors, e.vendorId)?.name ?? '—'))
      .sort((a, b) => b.date.localeCompare(a.date))
    const searchText = (r: (typeof rows)[number]) => `${r.category} ${r.description ?? ''} ${r.vendorName ?? ''}`
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/**
 * POST / — create an expense with optional pre-recorded instalments.
 * Validation ported from validateExpense: unit in writable scope, category + date
 * present, total > 0 and not implausibly large; if instalments are supplied their
 * sum must not exceed the total.
 */
expensesRouter.post(
  '/',
  requirePermission('expenses', 'create'),
  asyncHandler(async (req, res) => {
    const input = createExpenseSchema.parse(req.body)
    const s = getDb()

    assertUnit(req, input.unitId)
    validateVendorUnit(s, input.vendorId, input.unitId)
    if ((input.igstPct ?? 0) > 0 && ((input.cgstPct ?? 0) > 0 || (input.sgstPct ?? 0) > 0)) throw badRequest('Use either IGST or CGST + SGST, not both')
    if (!input.category.trim()) throw badRequest('Description is required')
    if (!(input.totalPaise > 0)) throw badRequest('Total payable must be greater than 0')
    if (input.totalPaise > 1e13) throw badRequest('Amount is implausibly large')

    const instalments: ExpenseInstalment[] = (input.instalments ?? []).map((i) => ({
      date: i.date,
      amountPaise: i.amountPaise as Paise,
      mode: i.mode as PaymentMode,
      ref: i.ref,
    }))
    const prepaid = instalments.reduce((acc, i) => addP(acc, i.amountPaise), 0 as Paise)
    if (prepaid > (input.totalPaise as Paise)) throw badRequest("Instalments exceed the expense total")

    const expense: Expense = {
      id: resolveId(input.id, (id) => !!getById(s.expenses.expenses, id), 'exp'),
      unitId: input.unitId,
      vendorId: input.vendorId,
      vendorName: input.vendorName ?? getById(s.masters.vendors, input.vendorId)?.name,
      category: input.category.trim(),
      description: input.description,
      date: input.date,
      dueDate: input.dueDate,
      ...lineItemFields(input),
      totalPaise: input.totalPaise as Paise,
      instalments,
      createdBy: req.auth!.user.id,
      createdAt: nowISO(),
    }

    await mutate((draft) => putEntity(draft.expenses.expenses, expense))

    const vendorName = expense.vendorName ?? expense.category
    res.status(201).json({
      data: toRow(expense, vendorName),
      cascade: [`Saved expense ${expense.category}`, `payable ${expense.totalPaise}`],
    })
  })
)

/**
 * PUT /:id — edit an expense. Same validation as create; the existing expense's
 * recorded `instalments` are preserved (an edit must NOT wipe payments), as are
 * id / createdBy / createdAt. Unit scope enforced via assertUnit on both the
 * existing row and the (possibly changed) target unit.
 */
expensesRouter.put(
  '/:id',
  requirePermission('expenses', 'edit'),
  asyncHandler(async (req, res) => {
    const input = createExpenseSchema.parse(req.body)
    const s = getDb()

    const existing = getById(s.expenses.expenses, req.params.id)
    if (!existing) throw notFound('Expense not found')
    assertUnit(req, existing.unitId)
    assertUnit(req, input.unitId)
    validateVendorUnit(s, input.vendorId, input.unitId)
    if ((input.igstPct ?? 0) > 0 && ((input.cgstPct ?? 0) > 0 || (input.sgstPct ?? 0) > 0)) throw badRequest('Use either IGST or CGST + SGST, not both')
    if (!input.category.trim()) throw badRequest('Description is required')
    if (!(input.totalPaise > 0)) throw badRequest('Total payable must be greater than 0')
    if (input.totalPaise > 1e13) throw badRequest('Amount is implausibly large')

    // An edit keeps the recorded instalments; they may not exceed the new total.
    const prepaid = existing.instalments.reduce((acc, i) => addP(acc, i.amountPaise), 0 as Paise)
    if (prepaid > (input.totalPaise as Paise)) throw badRequest('Instalments exceed the expense total')

    const updated: Expense = {
      ...existing,
      unitId: input.unitId,
      vendorId: input.vendorId,
      vendorName: input.vendorName ?? getById(s.masters.vendors, input.vendorId)?.name,
      category: input.category.trim(),
      description: input.description,
      date: input.date,
      dueDate: input.dueDate,
      ...lineItemFields(input),
      totalPaise: input.totalPaise as Paise,
      instalments: existing.instalments,
      id: existing.id,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
    }

    await mutate((draft) => putEntity(draft.expenses.expenses, updated))

    const vendorName = updated.vendorName ?? updated.category
    res.json({
      data: toRow(updated, vendorName),
      cascade: [`Updated expense ${updated.category}`, `payable ${updated.totalPaise}`],
    })
  })
)

/**
 * POST /:id/pay — append an instalment to an expense. Ported from
 * recordExpensePayment: amount > 0 and must not exceed the outstanding balance.
 * Balance/status stay derived — this only appends to the instalment list.
 */
expensesRouter.post(
  '/:id/pay',
  requirePermission('expenses', 'edit'),
  asyncHandler(async (req, res) => {
    const input = payExpenseSchema.parse(req.body)
    const s = getDb()

    const e = getById(s.expenses.expenses, req.params.id)
    if (!e) throw notFound('Expense not found')
    assertUnit(req, e.unitId)
    if (!(input.amountPaise > 0)) throw badRequest('Amount must be greater than 0')
    const balance = expenseBalance(e)
    if ((input.amountPaise as Paise) > balance) throw badRequest(`Exceeds the outstanding balance (${balance})`)

    const instalment: ExpenseInstalment = {
      date: input.date,
      amountPaise: input.amountPaise as Paise,
      mode: input.mode as PaymentMode,
      ref: input.ref,
    }
    const instalments = [...e.instalments, instalment]

    const updated = await mutate((draft) => {
      patchEntity(draft.expenses.expenses, e.id, { instalments })
      return getById(draft.expenses.expenses, e.id) as Expense
    })

    const bal = expenseBalance(updated)
    const vendorName = updated.vendorName ?? getById(s.masters.vendors, updated.vendorId)?.name ?? updated.category
    res.json({
      data: toRow(updated, vendorName),
      cascade: [
        `${input.amountPaise} paid to ${vendorName}`,
        bal <= 0 ? 'expense settled' : `balance ${bal}`,
      ],
    })
  })
)

/** DELETE /:id — remove an expense (and its instalments). Ported from deleteExpense. */
expensesRouter.delete(
  '/:id',
  requirePermission('expenses', 'delete'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const e = getById(s.expenses.expenses, req.params.id)
    if (!e) throw notFound('Expense not found')
    assertUnit(req, e.unitId)

    await mutate((draft) => removeEntity(draft.expenses.expenses, e.id))

    res.json({
      data: { id: e.id },
      cascade: [`Expense ${e.category} deleted`],
    })
  })
)
