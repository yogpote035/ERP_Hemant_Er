/**
 * Billing selectors (plan §5) — payment status + outstanding, all DERIVED.
 *
 * Invoice legal totals are SNAPSHOTTED at issue (`invoice.totals`), so payment
 * status reads that snapshot rather than recomputing tax. A draft (no totals
 * yet) has nothing due. Full invoice-composer derivation (issuer↔consignee
 * IGST/CGST split via `splitGst`) lands with P4 — this is the read side the
 * dashboard + payments screens consume now.
 */
import type { Id, Invoice } from '@/types/domain'
import { addP, subP, type Paise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { values, getById } from '@/store/normalized'
import type { RootState } from '@/store/state'
import { allowedUnitIds } from '@/store/scope'

const ZERO = 0 as Paise

/** Grand total a draft/issued invoice is liable for (0 until totals are snapshotted). */
export function invoiceGrand(inv: Invoice): Paise {
  return inv.totals?.grand ?? ZERO
}

/** Total received against one invoice across every payment's allocations. */
export function paidForInvoice(s: RootState, invoiceId: Id): Paise {
  let paid = ZERO
  for (const p of values(s.payments.payments)) {
    for (const a of p.allocations) {
      if (a.invoiceId === invoiceId) paid = addP(paid, a.amountPaise)
    }
  }
  return paid
}

export type PaymentStatus = 'draft' | 'unpaid' | 'partial' | 'paid' | 'overdue' | 'void'

/**
 * Where an invoice sits in the receivable lifecycle. Precedence:
 *   void (cancelled — owes nothing) > paid (fully settled, incl. a ₹0 total)
 *   > overdue (past due, not settled) > partial (some paid, not yet due) > unpaid.
 * 'overdue' deliberately outranks 'partial' so a part-paid-but-late invoice is
 * counted as overdue (the dashboard KPI depends on this). A voided invoice is
 * settled-to-zero here so every consumer (reports, Billing list) is correct by
 * construction — they must never report a cancelled bill as receivable.
 */
export function invoicePaymentStatus(s: RootState, inv: Invoice): PaymentStatus {
  if (inv.lifecycle === 'void') return 'void'
  if (inv.lifecycle === 'draft' || !inv.totals) return 'draft'
  const grand = invoiceGrand(inv)
  const paid = paidForInvoice(s, inv.id)
  if (paid >= grand) return 'paid' // grand === 0 (nothing owed) settles here too
  if (inv.dueDate && inv.dueDate < todayISO()) return 'overdue'
  if (paid > 0) return 'partial'
  return 'unpaid'
}

/** Amount still receivable on one invoice (never negative; a void owes nothing). */
export function outstandingForInvoice(s: RootState, inv: Invoice): Paise {
  if (inv.lifecycle === 'void') return ZERO
  const bal = subP(invoiceGrand(inv), paidForInvoice(s, inv.id))
  return (bal > 0 ? bal : ZERO) as Paise
}

export interface BillingTotals {
  /** Issued (non-draft, non-void) invoice grand-total sum. */
  invoiced: Paise
  /** Sum of outstanding across issued invoices. */
  outstanding: Paise
  /** Issued invoices whose due date has passed and aren't fully paid. */
  overdueCount: number
  issuedCount: number
  draftCount: number
}

/** Aggregate receivables across the units the current session may read. */
export function selectBillingTotals(s: RootState): BillingTotals {
  const allowed = allowedUnitIds(s)
  let invoiced = ZERO
  let outstanding = ZERO
  let overdueCount = 0
  let issuedCount = 0
  let draftCount = 0
  for (const inv of values(s.billing.invoices)) {
    if (!allowed.has(inv.unitId)) continue
    if (inv.lifecycle === 'void') continue
    if (inv.lifecycle === 'draft') {
      draftCount++
      continue
    }
    issuedCount++
    invoiced = addP(invoiced, invoiceGrand(inv))
    outstanding = addP(outstanding, outstandingForInvoice(s, inv))
    if (invoicePaymentStatus(s, inv) === 'overdue') overdueCount++
  }
  return { invoiced, outstanding, overdueCount, issuedCount, draftCount }
}

/** Resolve the consignee name for display (falls back to a placeholder). */
export function invoiceCustomerName(s: RootState, inv: Invoice): string {
  const c = getById(s.masters.customers, inv.customerId)
  return c?.name ?? '— unassigned —'
}
