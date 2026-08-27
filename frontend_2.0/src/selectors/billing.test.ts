import { describe, it, expect } from 'vitest'
import { createEmptyState } from '@/store/state'
import { putEntity } from '@/store/normalized'
import { toPaise, type Paise } from '@/lib/money'
import type { Invoice, InvoiceTotals, Payment, Unit, User } from '@/types/domain'
import type { RootState } from '@/store/state'
import {
  paidForInvoice,
  outstandingForInvoice,
  invoicePaymentStatus,
  selectBillingTotals,
} from './billing'

const Z = 0 as Paise
function totals(grand: number): InvoiceTotals {
  return { assessable: toPaise(grand), cgst: Z, sgst: Z, igst: Z, roundOff: Z, grand: toPaise(grand) }
}

/** Minimal issued invoice with a snapshotted grand total. */
function inv(id: string, grand: number, extra: Partial<Invoice> = {}): Invoice {
  return {
    id,
    unitId: 'u1',
    issuerKind: 'unit',
    issuerId: 'u1',
    billNo: id,
    fy: '24-25',
    seq: 1,
    invoiceDate: '2024-06-01',
    dispatchIds: [],
    lifecycle: 'sent',
    totals: totals(grand),
    createdBy: 'admin',
    createdAt: '2024-06-01',
    ...extra,
  }
}

function buildState(): RootState {
  const s = createEmptyState()
  const unit: Unit = {
    id: 'u1', name: 'HEW', code: 'HEW', gstin: 'X', stateCode: '27',
    addressLines: [], invoiceFormat: '{seq}/{FY}', seqPad: 3, active: true,
  }
  putEntity(s.masters.units, unit)
  const admin: User = {
    id: 'admin', name: 'Admin', email: 'a@a', role: 'admin',
    assignedUnitIds: ['u1'], active: true, createdAt: '2024-01-01',
  }
  putEntity(s.masters.users, admin)
  s.session = { currentUserId: 'admin', currentUnitId: 'ALL' }

  putEntity(s.billing.invoices, inv('unpaid', 1000, { dueDate: '2999-12-31' }))
  putEntity(s.billing.invoices, inv('paid', 500))
  putEntity(s.billing.invoices, inv('partial', 800))
  putEntity(s.billing.invoices, inv('overdue', 200, { dueDate: '2000-01-01' }))
  putEntity(s.billing.invoices, inv('partialOverdue', 400, { dueDate: '2000-01-01' }))
  putEntity(s.billing.invoices, inv('zero', 0)) // settled ₹0 invoice
  putEntity(s.billing.invoices, inv('draft', 999, { lifecycle: 'draft', totals: undefined }))
  putEntity(s.billing.invoices, inv('void', 999, { lifecycle: 'void' }))

  const pay: Payment = {
    id: 'pay1', mode: 'rtgs', ref: 'UTR1', date: '2024-07-01', amountPaise: toPaise(950),
    allocations: [
      { invoiceId: 'paid', amountPaise: toPaise(500) },
      { invoiceId: 'partial', amountPaise: toPaise(300) },
      { invoiceId: 'partialOverdue', amountPaise: toPaise(150) },
    ],
  }
  putEntity(s.payments.payments, pay)
  return s
}

describe('billing selectors', () => {
  const s = buildState()
  const byId = s.billing.invoices.byId

  it('paidForInvoice sums allocations across payments', () => {
    expect(paidForInvoice(s, 'paid')).toBe(toPaise(500))
    expect(paidForInvoice(s, 'partial')).toBe(toPaise(300))
    expect(paidForInvoice(s, 'unpaid')).toBe(0)
  })

  it('invoicePaymentStatus classifies the lifecycle correctly', () => {
    expect(invoicePaymentStatus(s, byId['paid']!)).toBe('paid')
    expect(invoicePaymentStatus(s, byId['partial']!)).toBe('partial')
    expect(invoicePaymentStatus(s, byId['unpaid']!)).toBe('unpaid')
    expect(invoicePaymentStatus(s, byId['overdue']!)).toBe('overdue')
    expect(invoicePaymentStatus(s, byId['draft']!)).toBe('draft')
    // overdue outranks partial: part-paid AND past due ⇒ overdue
    expect(invoicePaymentStatus(s, byId['partialOverdue']!)).toBe('overdue')
    // a ₹0 issued invoice is settled
    expect(invoicePaymentStatus(s, byId['zero']!)).toBe('paid')
    // a voided invoice owes nothing and is never an open receivable
    expect(invoicePaymentStatus(s, byId['void']!)).toBe('void')
  })

  it('outstanding never goes negative and nets payments', () => {
    expect(outstandingForInvoice(s, byId['paid']!)).toBe(0)
    expect(outstandingForInvoice(s, byId['partial']!)).toBe(toPaise(500))
    expect(outstandingForInvoice(s, byId['unpaid']!)).toBe(toPaise(1000))
    expect(outstandingForInvoice(s, byId['partialOverdue']!)).toBe(toPaise(250))
    expect(outstandingForInvoice(s, byId['zero']!)).toBe(0)
    // a voided invoice (snapshotted grand 999) settles to ZERO — not reported as AR
    expect(outstandingForInvoice(s, byId['void']!)).toBe(0)
  })

  it('selectBillingTotals rolls up issued invoices only (drafts/voids excluded)', () => {
    const t = selectBillingTotals(s)
    expect(t.issuedCount).toBe(6) // unpaid, paid, partial, overdue, partialOverdue, zero
    expect(t.draftCount).toBe(1)
    expect(t.invoiced).toBe(toPaise(2900)) // 1000+500+800+200+400+0
    expect(t.outstanding).toBe(toPaise(1950)) // 1000+0+500+200+250+0
    expect(t.overdueCount).toBe(2) // overdue + partialOverdue
  })
})
