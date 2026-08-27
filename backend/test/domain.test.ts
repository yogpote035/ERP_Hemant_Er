/**
 * Pure-domain unit tests — the ported money/stock/invoice/payroll math, exercised
 * directly on a fresh seeded RootState (no server, no I/O). These pin the numbers
 * the whole API depends on.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { seedState } from '../src/db/seed.js'
import { getById } from '../src/db/normalized.js'
import { deriveTaxKind, computeInvoice } from '../src/domain/invoiceCompute.js'
import { selectPartStock } from '../src/domain/stock.js'
import { outstandingForInvoice } from '../src/domain/billing.js'
import { productionEarned, shiftWage, selectEarnings } from '../src/domain/attendance.js'
import { computeScrap } from '../src/lib/scrapMath.js'
import type { Paise } from '../src/lib/money.js'

const s = seedState()

describe('invoiceCompute', () => {
  it('derives tax kind from issuer/customer state codes', () => {
    assert.equal(deriveTaxKind('27', '24'), 'igst') // inter-state
    assert.equal(deriveTaxKind('27', '27'), 'cgst_sgst') // intra-state
  })

  it('computes invoice 254 totals exactly (3 lines, 12% IGST, half-up round-off)', () => {
    const inv = getById(s.billing.invoices, 'inv-254')!
    const { totals } = computeInvoice(s, inv, deriveTaxKind('27', '24'))
    assert.equal(totals.assessable, 15157950)
    assert.equal(totals.igst, 1818954)
    assert.equal(totals.cgst, 0)
    assert.equal(totals.sgst, 0)
    assert.equal(totals.grand, 16976900)
    assert.equal(totals.roundOff, -4) // 16,976,904 → 16,976,900
  })

  it('splits intra-state tax into CGST+SGST (odd paisa to CGST)', () => {
    const inv = getById(s.billing.invoices, 'inv-254')!
    const { totals } = computeInvoice(s, inv, 'cgst_sgst')
    assert.equal(totals.igst, 0)
    assert.equal(totals.cgst + totals.sgst, 1818954)
    assert.ok(totals.cgst >= totals.sgst)
  })
})

describe('stock', () => {
  it('derives live available (opening + received − consumed)', () => {
    assert.equal(selectPartStock(s, 'u1', 'p6').available, 12000) // opening 2000 + 10000, no dispatch
    assert.equal(selectPartStock(s, 'u1', 'p3').available, 0) // 28000 received, fully dispatched
    assert.equal(selectPartStock(s, 'u1', 'p9').available, 6000) // 1000 + 8000 − 3000
  })

  it('honours the movement date window (opening only when the window excludes all moves)', () => {
    const future = selectPartStock(s, 'u1', 'p6', '2099-01-01', '2099-12-31')
    assert.equal(future.received, 0)
    assert.equal(future.consumed, 0)
    assert.equal(future.available, 2000) // opening still counts
  })
})

describe('billing — outstanding', () => {
  it('is grand for an unpaid sent invoice and zero for a settled one', () => {
    const i255 = getById(s.billing.invoices, 'inv-255')!
    const i254 = getById(s.billing.invoices, 'inv-254')!
    assert.equal(outstandingForInvoice(s, i255), 14862600) // no payment
    assert.equal(outstandingForInvoice(s, i254), 0) // pay1 settles it
  })
})

describe('scrap math', () => {
  it('computes value/GST/TCS/grand on integer paise', () => {
    const m = computeScrap(7_117_000, 3450 as Paise, 18, 1) // 7117 kg @ ₹34.50
    assert.equal(m.value, 24553650)
    assert.equal(m.gst, 4419657)
    assert.equal(m.tcs, 289733)
    assert.equal(m.grand, 29263040)
  })
})

describe('payroll', () => {
  it('derives production earnings and shift wages (with OT)', () => {
    const pa1 = getById(s.hr.production, 'pa1')!
    const sh1 = getById(s.hr.shifts, 'sh1')!
    assert.equal(productionEarned(pa1), 295000) // 1180 OK × ₹2.50
    assert.equal(shiftWage(sh1), 81000) // 8h × ₹700 + 1h OT × ₹110

    const rows = selectEarnings(s)
    assert.equal(rows.find((r) => r.employeeId === 'e1')!.total, 295000)
    assert.equal(rows.find((r) => r.employeeId === 'e2')!.total, 81000)
  })
})
