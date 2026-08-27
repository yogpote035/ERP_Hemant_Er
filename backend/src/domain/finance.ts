/**
 * finance.ts (plan P5) — derived reads for scrap, expenses, rejection advice.
 * Scrap math + expense balances/status are computed, never stored.
 *
 * Unit scope is passed explicitly as `allowed?: Set<Id> | null` (null = no scoping).
 */
import type { Expense, Id, RejectionAdvice, ScrapBill } from '../types/domain.js'
import { addP, subP, type Paise } from '../lib/money.js'
import { todayISO } from '../lib/id.js'
import { computeScrap, type ScrapMath } from '../lib/scrapMath.js'
import { values, getById } from '../db/normalized.js'
import type { RootState } from '../db/state.js'

const ZERO = 0 as Paise

// ── scrap ──────────────────────────────────────────────────────────────────────
export function scrapMathOf(b: ScrapBill): ScrapMath {
  return computeScrap(b.weightGrams, b.ratePerKgPaise, b.gstPct, b.tcsPct)
}

export interface ScrapRow {
  bill: ScrapBill
  customerName: string
  grand: Paise
}

export function selectScrapRows(s: RootState, allowed: Set<Id> | null = null): ScrapRow[] {
  return values(s.scrap.scrapBills)
    .filter((b) => !allowed || allowed.has(b.unitId))
    .map((b) => ({ bill: b, customerName: getById(s.masters.customers, b.customerId)?.name ?? '—', grand: scrapMathOf(b).grand }))
    .sort((a, b) => b.bill.invoiceDate.localeCompare(a.bill.invoiceDate))
}

export interface ScrapTotals {
  weightGrams: number
  revenue: Paise
  tcs: Paise
}
export function selectScrapTotals(s: RootState, allowed: Set<Id> | null = null): ScrapTotals {
  let weightGrams = 0
  let revenue = ZERO
  let tcs = ZERO
  for (const b of values(s.scrap.scrapBills)) {
    if (allowed && !allowed.has(b.unitId)) continue
    const m = scrapMathOf(b)
    weightGrams += b.weightGrams
    revenue = addP(revenue, m.grand)
    tcs = addP(tcs, m.tcs)
  }
  return { weightGrams, revenue, tcs }
}

// ── expenses ─────────────────────────────────────────────────────────────────
export function expensePaid(e: Expense): Paise {
  return e.instalments.reduce((acc, i) => addP(acc, i.amountPaise), ZERO)
}
export function expenseBalance(e: Expense): Paise {
  const bal = subP(e.totalPaise, expensePaid(e))
  return (bal > 0 ? bal : ZERO) as Paise
}

export type ExpenseStatus = 'unpaid' | 'partial' | 'paid' | 'overdue'
export function expenseStatus(e: Expense): ExpenseStatus {
  const paid = expensePaid(e)
  if (paid >= e.totalPaise) return 'paid'
  if (e.dueDate && e.dueDate < todayISO()) return 'overdue'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

export interface ExpenseRow {
  expense: Expense
  vendorName: string
  paid: Paise
  balance: Paise
  status: ExpenseStatus
}
export function selectExpenseRows(s: RootState, allowed: Set<Id> | null = null): ExpenseRow[] {
  return values(s.expenses.expenses)
    .filter((e) => !allowed || allowed.has(e.unitId))
    .map((e) => ({
      expense: e,
      vendorName: e.vendorName ?? getById(s.masters.vendors, e.vendorId)?.name ?? '—',
      paid: expensePaid(e),
      balance: expenseBalance(e),
      status: expenseStatus(e),
    }))
    .sort((a, b) => b.expense.date.localeCompare(a.expense.date))
}

export interface VendorOutstanding {
  vendorName: string
  outstanding: Paise
  count: number
}
export function selectVendorOutstanding(s: RootState, allowed: Set<Id> | null = null): VendorOutstanding[] {
  const map = new Map<string, VendorOutstanding>()
  for (const row of selectExpenseRows(s, allowed)) {
    if (row.balance <= 0) continue
    const cur = map.get(row.vendorName) ?? { vendorName: row.vendorName, outstanding: ZERO, count: 0 }
    cur.outstanding = addP(cur.outstanding, row.balance)
    cur.count += 1
    map.set(row.vendorName, cur)
  }
  return [...map.values()].sort((a, b) => b.outstanding - a.outstanding)
}

// ── rejection advice ────────────────────────────────────────────────────────
export interface RejectionRow {
  advice: RejectionAdvice
  customerName: string
  partNo: string
  challanNo: string
  weightKg: number
}
export function selectRejectionRows(s: RootState, allowed: Set<Id> | null = null): RejectionRow[] {
  return values(s.rejection.rejectionAdvices)
    .filter((r) => !allowed || allowed.has(r.unitId))
    .map((r) => ({
      advice: r,
      customerName: getById(s.masters.customers, r.customerId)?.name ?? '—',
      partNo: getById(s.masters.parts, r.partId)?.partNo ?? '—',
      challanNo: getById(s.inventory.inwards, r.sourceInwardId)?.challanNo ?? '—',
      weightKg: r.totalWeightGrams / 1000,
    }))
    .sort((a, b) => b.advice.rejDate.localeCompare(a.advice.rejDate))
}
