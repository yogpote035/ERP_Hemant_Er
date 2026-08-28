/**
 * expenseCommands.ts (plan P5) — overhead expenses with multi-instalment
 * payments. Balance + status are DERIVED (selectors/finance.ts); the store
 * holds the total and the instalment list only.
 */
import type { Expense, ExpenseInstalment, Id, ISODate, PaymentMode } from '@/types/domain'
import type { Paise } from '@/lib/money'
import { formatINRSymbol } from '@/lib/money'
import { expenseBalance } from '@/selectors/finance'
import { getById, putEntity, patchEntity, removeEntity } from './normalized'
import { writableUnitIds } from './scope'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

export interface ExpenseInput {
  id?: Id
  unitId: Id
  vendorId?: Id
  vendorName?: string
  category: string
  description?: string
  date: ISODate
  dueDate?: ISODate
  hsnSac?: string
  quantity?: number
  ratePaise?: Paise
  subTotalPaise?: Paise
  igstPct?: number
  cgstPct?: number
  sgstPct?: number
  tcsPct?: number
  supplierInvoiceNo?: string
  totalPaise: Paise
  /** Optional payment captured together with a newly-created supplier invoice. */
  instalments?: ExpenseInstalment[]
}

function validateExpense(s: RootState, input: ExpenseInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  if (input.vendorId) {
    const vendor = getById(s.masters.vendors, input.vendorId)
    if (!vendor || !vendor.active) errors.push('Unknown or inactive vendor')
    else if (vendor.unitId && vendor.unitId !== input.unitId) errors.push('Vendor does not belong to the selected unit')
    else if (!vendor.unitId) {
      const usedInUnit = Object.values(s.expenses.expenses.byId).some((e) => e?.unitId === input.unitId && e.vendorId === input.vendorId) ||
        Object.values(s.inventory.inwards.byId).some((i) => i?.unitId === input.unitId && i.vendorId === input.vendorId)
      if (!usedInUnit) errors.push('Assign this vendor to the selected unit in Vendor Management first')
    }
  }
  if (!input.category.trim()) errors.push('Description is required')
  if (!input.id && !input.vendorId) errors.push('Supplier name is required')
  if (!input.date) errors.push('Date is required')
  if (!(input.totalPaise > 0)) errors.push('Total payable must be greater than 0')
  else if (input.totalPaise > 1e13) errors.push('Amount is implausibly large') // ~₹10,000 cr guard vs fat-finger / exponent paste
  if ((input.igstPct ?? 0) > 0 && ((input.cgstPct ?? 0) > 0 || (input.sgstPct ?? 0) > 0)) errors.push('Use either IGST or CGST + SGST, not both')
  for (const pct of [input.igstPct, input.cgstPct, input.sgstPct, input.tcsPct]) if ((pct ?? 0) > 100) errors.push('Tax percentages cannot exceed 100%')
  const initialPaid = (input.instalments ?? []).reduce((sum, p) => sum + p.amountPaise, 0)
  if (initialPaid > input.totalPaise) errors.push('Payment amount cannot exceed grand total')
  if (input.id) {
    const existing = getById(s.expenses.expenses, input.id)
    if (existing) {
      const paid = existing.instalments.reduce((a, i) => a + i.amountPaise, 0)
      if (input.totalPaise < paid) errors.push(`Total can't be below what's already paid (${paid})`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyExpense(draft: RootState, input: ExpenseInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('exp')
  const existing = input.id ? getById(draft.expenses.expenses, input.id) : undefined
  const expense: Expense = {
    id,
    unitId: input.unitId,
    vendorId: input.vendorId,
    vendorName: input.vendorName ?? getById(draft.masters.vendors, input.vendorId)?.name,
    category: input.category.trim(),
    description: input.description,
    date: input.date,
    dueDate: input.dueDate,
    hsnSac: input.hsnSac,
    quantity: input.quantity,
    ratePaise: input.ratePaise,
    subTotalPaise: input.subTotalPaise,
    igstPct: input.igstPct,
    cgstPct: input.cgstPct,
    sgstPct: input.sgstPct,
    tcsPct: input.tcsPct,
    supplierInvoiceNo: input.supplierInvoiceNo,
    totalPaise: input.totalPaise,
    instalments: existing?.instalments ?? input.instalments ?? [],
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.expenses.expenses, expense)
  return {
    result: { id },
    cascade: [`${existing ? 'Updated' : 'Saved'} expense ${expense.category}`, `payable ${formatINRSymbol(expense.totalPaise)}`],
    summary: `${existing ? 'Updated' : 'Saved'} expense ${expense.category} (${formatINRSymbol(expense.totalPaise)})`,
    refs: [{ type: 'expense', id }],
    unitId: expense.unitId,
  }
}

const expCreate: Command<ExpenseInput, { id: Id }> = { name: 'saveExpense', module: 'expenses', action: 'create', validate: validateExpense, apply: applyExpense }
const expEdit: Command<ExpenseInput, { id: Id }> = { name: 'saveExpense', module: 'expenses', action: 'edit', validate: validateExpense, apply: applyExpense }
export function runSaveExpense(input: ExpenseInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? expEdit : expCreate, input)
}

// ── instalment ───────────────────────────────────────────────────────────────
export interface ExpensePaymentInput {
  expenseId: Id
  date: ISODate
  amountPaise: Paise
  mode: PaymentMode
  ref?: string
}

const expPayCmd: Command<ExpensePaymentInput, { id: Id }> = {
  name: 'recordExpensePayment',
  module: 'expenses',
  action: 'edit',
  validate(s, input) {
    const e = getById(s.expenses.expenses, input.expenseId)
    if (!e) return { ok: false, errors: ['Expense not found'] }
    if (!writableUnitIds(s).has(e.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    if (!(input.amountPaise > 0)) return { ok: false, errors: ['Amount must be greater than 0'] }
    if (input.amountPaise > expenseBalance(e)) return { ok: false, errors: [`Exceeds the outstanding balance (${expenseBalance(e)})`] }
    return { ok: true }
  },
  apply(draft, input) {
    const e = getById(draft.expenses.expenses, input.expenseId) as Expense
    const instalments = [...e.instalments, { date: input.date, amountPaise: input.amountPaise, mode: input.mode, ref: input.ref }]
    patchEntity(draft.expenses.expenses, e.id, { instalments })
    const paid = instalments.reduce((a, i) => a + i.amountPaise, 0)
    const bal = e.totalPaise - paid
    return {
      result: { id: e.id },
      cascade: [
        `${formatINRSymbol(input.amountPaise)} paid to ${e.vendorName ?? e.category}`,
        bal <= 0 ? 'expense settled' : `balance ${formatINRSymbol((bal > 0 ? bal : 0) as Paise)}`,
      ],
      summary: `Expense payment ${formatINRSymbol(input.amountPaise)} on ${e.category}`,
      refs: [{ type: 'expense', id: e.id }],
      unitId: e.unitId,
    }
  },
}
export function runRecordExpensePayment(input: ExpensePaymentInput): CommandResult<{ id: Id }> {
  return runCommand(expPayCmd, input)
}

// ── delete ───────────────────────────────────────────────────────────────────
const expDeleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteExpense',
  module: 'expenses',
  action: 'delete',
  validate(s, input) {
    const e = getById(s.expenses.expenses, input.id)
    if (!e) return { ok: false, errors: ['Expense not found'] }
    if (!writableUnitIds(s).has(e.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const e = getById(draft.expenses.expenses, input.id) as Expense
    removeEntity(draft.expenses.expenses, input.id)
    return {
      result: { id: input.id },
      cascade: [`Expense ${e.category} deleted`],
      summary: `Deleted expense ${e.category} (${formatINRSymbol(e.totalPaise)})`,
      refs: [{ type: 'expense', id: input.id }],
      unitId: e.unitId,
    }
  },
}
export function runDeleteExpense(id: Id): CommandResult<{ id: Id }> {
  return runCommand(expDeleteCmd, { id })
}
