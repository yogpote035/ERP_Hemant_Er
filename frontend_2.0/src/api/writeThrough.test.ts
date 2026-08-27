import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

// Mock the module client so we assert ROUTING, not the network.
vi.mock('./modules', () => {
  const f = () => vi.fn(() => Promise.resolve({}))
  return {
    mastersApi: { create: f(), update: f(), remove: f(), list: f(), setActive: f() },
    inwardApi: { create: f(), update: f(), remove: f() },
    dispatchApi: { create: f(), remove: f() },
    invoicesApi: { finalize: f(), void: f() },
    paymentsApi: { record: f(), reverse: f() },
    scrapApi: { create: f(), update: f(), remove: f() },
    expensesApi: { create: f(), update: f(), pay: f(), remove: f() },
    rejectionApi: { create: f(), update: f(), remove: f() },
    attendanceApi: { createProduction: f(), removeProduction: f(), createShift: f(), removeShift: f() },
    ratesApi: { createRm: f(), createProduction: f() },
    usersApi: { create: f(), update: f(), setActive: f() },
    systemApi: { backup: f(), restore: f(), resetDemo: f() },
  }
})

import { useStore, login } from '@/store'
import { values } from '@/store/normalized'
import { seedState } from '@/lib/seed'
import { toPaise } from '@/lib/money'
import type { Role } from '@/types/rbac'
import { runSaveInward, runDeleteInward, runSaveDispatch, runDeleteDispatch } from '@/store/registerCommands'
import { runSaveScrapBill, runSaveRejectionAdvice } from '@/store/scrapCommands'
import { runSaveExpense } from '@/store/expenseCommands'
import { runSaveProductionAttendance } from '@/store/attendanceCommands'
import { MASTER_SPECS } from '@/masters/registry'
import { installWriteThrough } from './writeThrough'
import * as M from './modules'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const flush = () => new Promise((r) => setTimeout(r, 0))

beforeAll(() => {
  installWriteThrough()
})
beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('manager')) // non-admin with broad perms → exercises the module-endpoint path
  vi.clearAllMocks()
})

describe('write-through routing (non-admin → module endpoints)', () => {
  it('routes inward create / edit / delete to the inward endpoints', async () => {
    const id = runSaveInward({ unitId: 'u1', partId: 'p1', challanNo: 'WT-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 100 }).data.id
    await flush()
    expect(M.inwardApi.create).toHaveBeenCalledTimes(1)

    runSaveInward({ id, unitId: 'u1', partId: 'p1', challanNo: 'WT-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 120 })
    await flush()
    expect(M.inwardApi.update).toHaveBeenCalledWith(id, expect.objectContaining({ id }))

    runDeleteInward(id)
    await flush()
    expect(M.inwardApi.remove).toHaveBeenCalledWith(id)
  })

  it('routes dispatch create + delete (deleteEntity disambiguated by module)', async () => {
    const inwId = runSaveInward({ unitId: 'u1', partId: 'p1', challanNo: 'WT-D', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 500 }).data.id
    await flush()
    const dId = runSaveDispatch({ inwardId: inwId, kind: 'billed', okQty: 50, mcRejQty: 0, mfQty: 0, billNo: 'WTB-1', ratePaise: toPaise(10) }).data.id
    await flush()
    expect(M.dispatchApi.create).toHaveBeenCalledTimes(1)

    runDeleteDispatch(dId)
    await flush()
    expect(M.dispatchApi.remove).toHaveBeenCalledWith(dId)
    expect(M.inwardApi.remove).not.toHaveBeenCalled()
  })

  it('routes scrap / expense / rejection creates', async () => {
    runSaveScrapBill({ unitId: 'u1', customerId: 'c1', periodFrom: '2025-01-01', periodTo: '2025-01-15', weightGrams: 100000, ratePerKgPaise: toPaise(34), gstPct: 18, tcsPct: 1, scrapInvoiceNo: 'WT-SC', invoiceDate: '2025-01-16' })
    runSaveExpense({ unitId: 'u1', category: 'Misc', date: '2025-04-01', totalPaise: toPaise(1000) })
    runSaveRejectionAdvice({ unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'WT-RJ', rejDate: '2025-04-01', mrQty: 5, frQty: 0, weightBasis: 'scrap' })
    await flush()
    expect(M.scrapApi.create).toHaveBeenCalledTimes(1)
    expect(M.expensesApi.create).toHaveBeenCalledTimes(1)
    expect(M.rejectionApi.create).toHaveBeenCalledTimes(1)
  })

  it('routes a master save to /masters/:entity by id prefix', async () => {
    const customer = MASTER_SPECS.find((s) => s.key === 'customer')!
    customer.save({ name: 'WT Customer', gstin: '27ZZZZZ0000Z1Z9', stateCode: '27', addressLines: 'Pune' }, null)
    await flush()
    expect(M.mastersApi.create).toHaveBeenCalledTimes(1)
    expect(M.mastersApi.create).toHaveBeenCalledWith('customers', expect.objectContaining({ name: 'WT Customer' }))
  })

  it('routes attendance + expense-edit + rejection-edit (previously local-only)', async () => {
    // attendance create → /attendance/production
    runSaveProductionAttendance({ unitId: 'u1', date: '2025-04-01', employeeId: 'e1', machineId: 'm1', partId: 'p3', operationId: 'op-1f', standard: 100, plan: 100, totalMakeQty: 100, okQty: 95, scrapQty: 5, reworkQty: 0, mfQty: 0 })
    await flush()
    expect(M.attendanceApi.createProduction).toHaveBeenCalledTimes(1)

    // expense create then EDIT → /expenses (create) then PUT
    const expId = runSaveExpense({ unitId: 'u1', category: 'Tooling', date: '2025-04-01', totalPaise: toPaise(500) }).data.id
    await flush()
    runSaveExpense({ id: expId, unitId: 'u1', category: 'Consumables', date: '2025-04-01', totalPaise: toPaise(500) })
    await flush()
    expect(M.expensesApi.create).toHaveBeenCalledTimes(1)
    expect(M.expensesApi.update).toHaveBeenCalledWith(expId, expect.objectContaining({ id: expId }))

    // rejection create then EDIT → /rejection then PUT
    const rejId = runSaveRejectionAdvice({ unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'WT-E', rejDate: '2025-04-01', mrQty: 5, frQty: 0, weightBasis: 'scrap' }).data.id
    await flush()
    runSaveRejectionAdvice({ id: rejId, unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'WT-E', rejDate: '2025-04-01', mrQty: 9, frQty: 0, weightBasis: 'scrap' })
    await flush()
    expect(M.rejectionApi.update).toHaveBeenCalledWith(rejId, expect.objectContaining({ id: rejId }))
  })
})
