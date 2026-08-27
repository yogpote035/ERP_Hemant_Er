import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { toPaise } from '@/lib/money'
import { CommandValidationError } from './commands'
import { undo } from './commandBus'
import type { Role } from '@/types/rbac'
import { runSaveInward, runDeleteInward } from './registerCommands'
import { runSaveScrapBill, runSaveRejectionAdvice, runDeleteScrapBill, runDeleteRejectionAdvice } from './scrapCommands'
import { runSaveExpense, runRecordExpensePayment, runDeleteExpense } from './expenseCommands'
import { expenseStatus, expenseBalance, scrapMathOf } from '@/selectors/finance'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const u1Part = () => values(st().masters.parts).find((p) => p.unitId === 'u1')!
const aCustomer = () => values(st().masters.customers)[0]!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

describe('scrap bills', () => {
  it('saves a scrap bill and blocks a duplicate invoice no.', () => {
    const res = runSaveScrapBill({
      unitId: 'u1', customerId: aCustomer().id, periodFrom: '2025-04-01', periodTo: '2025-04-15',
      weightGrams: 7117 * 1000, ratePerKgPaise: toPaise(34.5), gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'SCR-1', invoiceDate: '2025-04-16',
    })
    const bill = getById(st().scrap.scrapBills, res.data.id)!
    expect(scrapMathOf(bill).grand).toBe(29263040)
    expect(() =>
      runSaveScrapBill({
        unitId: 'u1', customerId: aCustomer().id, periodFrom: '2025-04-01', periodTo: '2025-04-15',
        weightGrams: 1000, ratePerKgPaise: toPaise(30), gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'SCR-1', invoiceDate: '2025-04-17',
      })
    ).toThrow(CommandValidationError)
  })
})

describe('expenses + instalments', () => {
  it('derives balance/status across instalments and blocks an over-payment', () => {
    const id = runSaveExpense({ unitId: 'u1', category: 'Power', date: '2025-04-01', totalPaise: toPaise(10000) }).data.id
    expect(expenseStatus(getById(st().expenses.expenses, id)!)).toBe('unpaid')

    runRecordExpensePayment({ expenseId: id, date: '2025-04-05', amountPaise: toPaise(4000), mode: 'rtgs' })
    expect(expenseStatus(getById(st().expenses.expenses, id)!)).toBe('partial')
    expect(expenseBalance(getById(st().expenses.expenses, id)!)).toBe(toPaise(6000))

    expect(() => runRecordExpensePayment({ expenseId: id, date: '2025-04-06', amountPaise: toPaise(7000), mode: 'cash' })).toThrow(CommandValidationError)

    runRecordExpensePayment({ expenseId: id, date: '2025-04-07', amountPaise: toPaise(6000), mode: 'cash' })
    expect(expenseStatus(getById(st().expenses.expenses, id)!)).toBe('paid')
  })
})

describe('rejection advice', () => {
  it('computes weight from rejected pcs × per-ring finish weight', () => {
    const part = u1Part()
    const inwId = runSaveInward({ unitId: 'u1', partId: part.id, challanNo: 'REJ-SRC', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 500 }).data.id
    const res = runSaveRejectionAdvice({
      unitId: 'u1', customerId: aCustomer().id, partId: part.id, sourceInwardId: inwId,
      rejDcNo: 'DC-R1', rejDate: '2025-04-10', mrQty: 100, frQty: 20, weightBasis: 'finish',
    })
    const adv = getById(st().rejection.rejectionAdvices, res.data.id)!
    expect(adv.totalWeightGrams).toBe(Math.round((120 * part.finishWtMg) / 1000))
    expect(adv.weightPerRingMg).toBe(part.finishWtMg)
  })
})

describe('finance edit + delete', () => {
  it('edits a scrap bill in place (same id, new figures) and then deletes it', () => {
    const id = runSaveScrapBill({
      unitId: 'u1', customerId: aCustomer().id, periodFrom: '2025-04-01', periodTo: '2025-04-15',
      weightGrams: 1000 * 1000, ratePerKgPaise: toPaise(30), gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'SCR-E1', invoiceDate: '2025-04-16',
    }).data.id

    // Editing keeps the same id and is allowed to reuse its own invoice no.
    const edited = runSaveScrapBill({
      id, unitId: 'u1', customerId: aCustomer().id, periodFrom: '2025-04-01', periodTo: '2025-04-15',
      weightGrams: 2000 * 1000, ratePerKgPaise: toPaise(35), gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'SCR-E1', invoiceDate: '2025-04-16',
    }).data.id
    expect(edited).toBe(id)
    expect(getById(st().scrap.scrapBills, id)!.weightGrams).toBe(2000 * 1000)

    runDeleteScrapBill(id)
    expect(getById(st().scrap.scrapBills, id)).toBeUndefined()
  })

  it('deletes an expense (with its instalments)', () => {
    const id = runSaveExpense({ unitId: 'u1', category: 'Rent', date: '2025-04-01', totalPaise: toPaise(5000) }).data.id
    runRecordExpensePayment({ expenseId: id, date: '2025-04-05', amountPaise: toPaise(2000), mode: 'rtgs' })
    expect(getById(st().expenses.expenses, id)).toBeDefined()

    runDeleteExpense(id)
    expect(getById(st().expenses.expenses, id)).toBeUndefined()
  })

  it('undo of a delete restores the entity AND its nested data (cascade-safe via immer patches)', () => {
    const id = runSaveExpense({ unitId: 'u1', category: 'Power', date: '2025-04-01', totalPaise: toPaise(10000) }).data.id
    runRecordExpensePayment({ expenseId: id, date: '2025-04-05', amountPaise: toPaise(4000), mode: 'rtgs' })
    expect(getById(st().expenses.expenses, id)!.instalments).toHaveLength(1)

    runDeleteExpense(id)
    expect(getById(st().expenses.expenses, id)).toBeUndefined()

    undo()
    const restored = getById(st().expenses.expenses, id)
    expect(restored).toBeDefined()
    expect(restored!.instalments).toHaveLength(1) // the nested instalment came back too
    expect(restored!.totalPaise).toBe(toPaise(10000))
  })

  it('edits and deletes a rejection advice', () => {
    const part = u1Part()
    const inwId = runSaveInward({ unitId: 'u1', partId: part.id, challanNo: 'REJ-SRC2', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 500 }).data.id
    const id = runSaveRejectionAdvice({
      unitId: 'u1', customerId: aCustomer().id, partId: part.id, sourceInwardId: inwId,
      rejDcNo: 'DC-E1', rejDate: '2025-04-10', mrQty: 100, frQty: 20, weightBasis: 'finish',
    }).data.id

    const edited = runSaveRejectionAdvice({
      id, unitId: 'u1', customerId: aCustomer().id, partId: part.id, sourceInwardId: inwId,
      rejDcNo: 'DC-E1', rejDate: '2025-04-10', mrQty: 200, frQty: 0, weightBasis: 'finish',
    }).data.id
    expect(edited).toBe(id)
    expect(getById(st().rejection.rejectionAdvices, id)!.mrQty).toBe(200)

    runDeleteRejectionAdvice(id)
    expect(getById(st().rejection.rejectionAdvices, id)).toBeUndefined()
  })
})

describe('rejection advice guards', () => {
  it('caps cumulative rejected qty at the challan received qty and blocks duplicate DC no.', () => {
    const part = u1Part()
    const inwId = runSaveInward({ unitId: 'u1', partId: part.id, challanNo: 'REJ-CAP', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 100 }).data.id
    const base = { unitId: 'u1', customerId: aCustomer().id, partId: part.id, sourceInwardId: inwId, rejDate: '2025-04-10', weightBasis: 'finish' as const }
    // a single advice over the received qty → rejected
    expect(() => runSaveRejectionAdvice({ ...base, rejDcNo: 'DCX', mrQty: 80, frQty: 40 })).toThrow(CommandValidationError)
    // within the cap → ok
    runSaveRejectionAdvice({ ...base, rejDcNo: 'DCX', mrQty: 60, frQty: 0 })
    // a SECOND advice whose cumulative (60+50) exceeds 100 → rejected
    expect(() => runSaveRejectionAdvice({ ...base, rejDcNo: 'DCY', mrQty: 50, frQty: 0 })).toThrow(CommandValidationError)
    // reusing the DC no. in the same unit → rejected
    expect(() => runSaveRejectionAdvice({ ...base, rejDcNo: 'DCX', mrQty: 10, frQty: 0 })).toThrow(CommandValidationError)
  })

  it('blocks deleting an inward that a rejection advice still references', () => {
    const part = u1Part()
    const inwId = runSaveInward({ unitId: 'u1', partId: part.id, challanNo: 'REJ-DEL', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 200 }).data.id
    const rejId = runSaveRejectionAdvice({ unitId: 'u1', customerId: aCustomer().id, partId: part.id, sourceInwardId: inwId, rejDcNo: 'DCZ', rejDate: '2025-04-10', mrQty: 10, frQty: 0, weightBasis: 'finish' }).data.id
    expect(() => runDeleteInward(inwId)).toThrow(CommandValidationError)
    // once the advice is gone, the inward can be deleted
    runDeleteRejectionAdvice(rejId)
    expect(() => runDeleteInward(inwId)).not.toThrow()
  })
})
