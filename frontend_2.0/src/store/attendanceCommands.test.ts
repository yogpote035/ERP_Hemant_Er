import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { toPaise, mulQty } from '@/lib/money'
import { CommandValidationError } from './commands'
import type { Role } from '@/types/rbac'
import {
  runSaveProductionAttendance,
  runSaveShiftAttendance,
  runDeleteProductionAttendance,
  runDeleteShiftAttendance,
} from './attendanceCommands'
import { makeQty, productionEarned, shiftHours, shiftWage } from '@/selectors/attendance'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const u1Part = () => values(st().masters.parts).find((p) => p.unitId === 'u1')!
const anEmployee = () => values(st().masters.employees)[0]!
const aMachine = () => values(st().masters.machines)[0]!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
  // Insert a wildcard production rate so the part resolves a rate on any machine.
  const part = u1Part()
  useStore.setState((s) => {
    const pr = { id: 'pr-test', partId: part.id, ratePaise: toPaise(3), effectiveFrom: '2025-01-01' }
    return {
      masters: {
        ...s.masters,
        productionRates: {
          byId: { ...s.masters.productionRates.byId, 'pr-test': pr },
          allIds: [...s.masters.productionRates.allIds, 'pr-test'],
        },
      },
    }
  })
})

describe('production attendance', () => {
  it('uses totalMakeQty for makeQty, snapshots the rate and records the breakdown', () => {
    const res = runSaveProductionAttendance({
      unitId: 'u1', date: '2025-05-01', employeeId: anEmployee().id, machineId: aMachine().id, partId: u1Part().id,
      standard: 1000, plan: 1500, totalMakeQty: 500, okQty: 480, scrapQty: 15, reworkQty: 5,
    })
    const e = getById(st().hr.production, res.data.id)!
    expect(makeQty(e)).toBe(500)
    expect(e.scrapQty).toBe(15)
    expect(e.reworkQty).toBe(5)
    expect(e.rateSnapshotPaise).toBe(toPaise(3))
    expect(productionEarned(e)).toBe(mulQty(toPaise(3), 480))
  })

  it('rejects a production breakdown (OK+Scrap+Rework+MF) greater than total made', () => {
    expect(() =>
      runSaveProductionAttendance({
        unitId: 'u1', date: '2025-05-01', employeeId: anEmployee().id, machineId: aMachine().id, partId: u1Part().id,
        standard: 1000, plan: 1500, totalMakeQty: 500, okQty: 480, scrapQty: 30,
      })
    ).toThrow(CommandValidationError)
  })
})

describe('shift attendance', () => {
  it('derives hours + wage from the employee shift rate and rejects a reversed window', () => {
    const emp = anEmployee()
    const res = runSaveShiftAttendance({ unitId: 'u1', date: '2025-05-01', employeeId: emp.id, fromTime: '09:00', toTime: '17:00' })
    const e = getById(st().hr.shifts, res.data.id)!
    expect(shiftHours(e)).toBe(8)
    expect(e.shiftRateSnapshotPaise).toBe(emp.standardShiftRatePaise)
    expect(shiftWage(e)).toBe(emp.standardShiftRatePaise) // 8/8 × rate
    expect(() => runSaveShiftAttendance({ unitId: 'u1', date: '2025-05-01', employeeId: emp.id, fromTime: '17:00', toTime: '09:00' })).toThrow(CommandValidationError)
  })
})

describe('attendance delete', () => {
  it('removes a production entry', () => {
    const res = runSaveProductionAttendance({
      unitId: 'u1', date: '2025-05-01', employeeId: anEmployee().id, machineId: aMachine().id, partId: u1Part().id,
      standard: 1000, plan: 1500, totalMakeQty: 500, okQty: 480,
    })
    expect(getById(st().hr.production, res.data.id)).toBeTruthy()
    runDeleteProductionAttendance(res.data.id)
    expect(getById(st().hr.production, res.data.id)).toBeUndefined()
  })

  it('removes a shift entry', () => {
    const res = runSaveShiftAttendance({ unitId: 'u1', date: '2025-05-01', employeeId: anEmployee().id, fromTime: '09:00', toTime: '17:00' })
    expect(getById(st().hr.shifts, res.data.id)).toBeTruthy()
    runDeleteShiftAttendance(res.data.id)
    expect(getById(st().hr.shifts, res.data.id)).toBeUndefined()
  })

  it('rejects deleting a non-existent production entry', () => {
    expect(() => runDeleteProductionAttendance('does-not-exist')).toThrow(CommandValidationError)
  })
})
