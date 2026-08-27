import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { toPaise, type Paise } from '@/lib/money'
import { CommandValidationError } from './commands'
import type { Role } from '@/types/rbac'
import { runSaveInward, runSaveDispatch } from './registerCommands'
import { runFinalizeInvoice, runVoidInvoice, runRecordPayment, runReversePayment } from './billingCommands'
import { outstandingForInvoice, invoicePaymentStatus, invoiceGrand } from '@/selectors/billing'
import { selectInvoicePdfModel } from '@/selectors/invoiceCompute'
import { ALL_SPECS } from '@/masters/registry'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const u1Part = () => values(st().masters.parts).find((p) => p.unitId === 'u1')!
const custInState = (code: string) => values(st().masters.customers).find((c) => c.stateCode === code)!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

/** Create a fresh inward + one billed dispatch → returns the draft invoice id for that bill no. */
function draftBill(billNo: string, ok = 100, rate = 10): string {
  const inwId = runSaveInward({
    unitId: 'u1', partId: u1Part().id, challanNo: `BILL-CH-${billNo}`, challanDate: '2025-05-01', batchHeatNo: 'H', receivedQty: ok,
  }).data.id
  runSaveDispatch({ inwardId: inwId, kind: 'billed', okQty: ok, mcRejQty: 0, mfQty: 0, billNo, ratePaise: toPaise(rate) })
  return values(st().billing.invoices).find((i) => i.billNo === billNo && i.unitId === 'u1')!.id
}

describe('finalizeInvoice', () => {
  it('intra-state consignee → CGST+SGST; assessable = qty × rate', () => {
    const id = draftBill('FB-INTRA', 100, 10)
    const intra = custInState('27') // u1 (HEW) is state 27
    const res = runFinalizeInvoice({ invoiceId: id, customerId: intra.id, issuerKind: 'unit' })
    expect(res.ok).toBe(true)
    const inv = getById(st().billing.invoices, id)!
    expect(inv.lifecycle).toBe('sent')
    expect(inv.taxKind).toBe('cgst_sgst')
    expect(inv.totals!.assessable).toBe(toPaise(1000))
    expect(inv.totals!.igst).toBe(0)
    expect(inv.totals!.cgst + inv.totals!.sgst).toBeGreaterThan(0)
  })

  it('inter-state consignee → IGST, and a draft cannot be re-finalized', () => {
    const id = draftBill('FB-INTER', 50, 8)
    const inter = custInState('24') // Rolex, Gujarat
    runFinalizeInvoice({ invoiceId: id, customerId: inter.id, issuerKind: 'unit' })
    const inv = getById(st().billing.invoices, id)!
    expect(inv.taxKind).toBe('igst')
    expect(inv.totals!.igst).toBeGreaterThan(0)
    expect(inv.totals!.cgst).toBe(0)
    expect(() => runFinalizeInvoice({ invoiceId: id, customerId: inter.id, issuerKind: 'unit' })).toThrow(CommandValidationError)
  })
})

describe('recordPayment + void', () => {
  it('allocates a receipt, dropping outstanding; over-allocation is rejected', () => {
    const id = draftBill('PB-1', 100, 10)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    const grand = invoiceGrand(getById(st().billing.invoices, id)!)
    const half = Math.round(grand / 2) as Paise

    runRecordPayment({ mode: 'rtgs', ref: 'UTR1', date: '2025-05-10', amountPaise: half, allocations: [{ invoiceId: id, amountPaise: half }] })
    expect(invoicePaymentStatus(st(), getById(st().billing.invoices, id)!)).toBe('partial')
    expect(outstandingForInvoice(st(), getById(st().billing.invoices, id)!)).toBe((grand - half) as Paise)

    // Can't allocate more than the remaining outstanding.
    expect(() =>
      runRecordPayment({ mode: 'rtgs', ref: 'UTR2', date: '2025-05-11', amountPaise: grand, allocations: [{ invoiceId: id, amountPaise: grand }] })
    ).toThrow(CommandValidationError)
  })

  it('rejects two allocations to the SAME invoice that together overpay it', () => {
    const id = draftBill('PB-OVER', 100, 10)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    const grand = invoiceGrand(getById(st().billing.invoices, id)!)
    const half = Math.round(grand / 2) as Paise
    // Each line ≤ outstanding individually, but summed they exceed the grand → rejected.
    expect(() =>
      runRecordPayment({
        mode: 'rtgs', ref: 'UTR3', date: '2025-05-13', amountPaise: (half + grand) as Paise,
        allocations: [{ invoiceId: id, amountPaise: grand }, { invoiceId: id, amountPaise: half }],
      })
    ).toThrow(CommandValidationError)
  })

  it('settles fully then blocks voiding a paid invoice', () => {
    const id = draftBill('PB-2', 100, 10)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    const grand = invoiceGrand(getById(st().billing.invoices, id)!)
    runRecordPayment({ mode: 'cheque', ref: 'CHQ', date: '2025-05-12', amountPaise: grand, allocations: [{ invoiceId: id, amountPaise: grand }] })
    expect(invoicePaymentStatus(st(), getById(st().billing.invoices, id)!)).toBe('paid')
    expect(() => runVoidInvoice(id)).toThrow(CommandValidationError)
  })

  it('voids an unpaid issued invoice', () => {
    const id = draftBill('PB-3', 40, 5)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    runVoidInvoice(id)
    expect(getById(st().billing.invoices, id)!.lifecycle).toBe('void')
  })

  it('reversing a payment restores outstanding and unlocks the invoice', () => {
    const id = draftBill('PB-REV', 100, 10)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    const grand = invoiceGrand(getById(st().billing.invoices, id)!)
    const payId = runRecordPayment({ mode: 'cheque', ref: 'BOUNCED', date: '2025-05-14', amountPaise: grand, allocations: [{ invoiceId: id, amountPaise: grand }] }).data.id
    expect(invoicePaymentStatus(st(), getById(st().billing.invoices, id)!)).toBe('paid')
    expect(() => runVoidInvoice(id)).toThrow(CommandValidationError) // locked while fully paid

    runReversePayment(payId)
    expect(getById(st().payments.payments, payId)).toBeUndefined()
    expect(outstandingForInvoice(st(), getById(st().billing.invoices, id)!)).toBe(grand)
    expect(invoicePaymentStatus(st(), getById(st().billing.invoices, id)!)).toBe('unpaid')
    expect(() => runVoidInvoice(id)).not.toThrow() // reversal freed it
  })
})

describe('issued-invoice immutability (Phase B snapshots)', () => {
  it('freezes consignee identity at finalize — editing the customer master cannot rewrite a sent invoice', () => {
    const id = draftBill('FB-SNAP', 100, 10)
    const cust = custInState('24')
    runFinalizeInvoice({ invoiceId: id, customerId: cust.id, issuerKind: 'unit' })
    const before = selectInvoicePdfModel(st(), id)!
    expect(before.custName).toBe(cust.name)
    expect(before.custGstin).toBe(cust.gstin)

    // Rename the customer master after the invoice is issued.
    const customer = ALL_SPECS.find((s) => s.key === 'customer')!
    customer.save({ name: 'RENAMED PVT LTD', gstin: cust.gstin, stateCode: cust.stateCode }, cust)
    expect(getById(st().masters.customers, cust.id)!.name).toBe('RENAMED PVT LTD')

    // The issued invoice's PDF + list name stay the SNAPSHOT, not the live master.
    const after = selectInvoicePdfModel(st(), id)!
    expect(after.custName).toBe(cust.name)
    expect(after.custName).not.toBe('RENAMED PVT LTD')
  })

  it('freezes line items at finalize — editing the part master cannot restate the printed lines', () => {
    const id = draftBill('FB-LINES', 50, 8)
    runFinalizeInvoice({ invoiceId: id, customerId: custInState('24').id, issuerKind: 'unit' })
    const partNoBefore = selectInvoicePdfModel(st(), id)!.lines[0]!.partNo
    // Rename the part used on the bill.
    const part = u1Part()
    const partSpec = ALL_SPECS.find((s) => s.key === 'part')!
    partSpec.save(
      { partNo: 'RENAMED-PART', materialCode: part.materialCode, unitId: part.unitId, uom: part.uom, hsnSac: part.hsnSac, gstPct: String(part.gstPct), finishWtG: part.finishWtMg / 1000, scrapWtG: part.scrapWtMg / 1000, avgQtyPerBox: part.avgQtyPerBox },
      part
    )
    const after = selectInvoicePdfModel(st(), id)!.lines[0]!.partNo
    expect(after).toBe(partNoBefore)
    expect(after).not.toBe('RENAMED-PART')
  })
})
