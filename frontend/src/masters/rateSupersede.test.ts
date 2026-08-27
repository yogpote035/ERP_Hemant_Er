import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from '@/store'
import { seedState } from '@/lib/seed'
import { values, getById } from '@/store/normalized'
import { latestProductionRate } from '@/selectors/attendance'
import { toPaise } from '@/lib/money'
import type { Role } from '@/types/rbac'
import { RATE_SPECS } from './registry'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const u1Part = () => values(st().masters.parts).find((p) => p.unitId === 'u1')!
const u1Machine = () => values(st().masters.machines).find((m) => m.unitId === 'u1')!
const anOperation = () => values(st().masters.operations)[0]!

const rmRate = RATE_SPECS.find((s) => s.key === 'rmRate')!
const prodRate = RATE_SPECS.find((s) => s.key === 'prodRate')!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

describe('rate auto-supersede (afterUpsert)', () => {
  it('a newer RM rate supersedes the prior current rate for the same part', () => {
    const part = u1Part()
    const r1 = rmRate.save({ partId: part.id, rate: 10, effectiveFrom: '2025-01-01' }, null)
    const r2 = rmRate.save({ partId: part.id, rate: 12, effectiveFrom: '2025-06-01' }, null)

    expect(getById(st().masters.rmRates, r1.data.id)!.supersededAt).toBe('2025-06-01')
    expect(getById(st().masters.rmRates, r2.data.id)!.supersededAt).toBeUndefined()
  })

  it('does not supersede a different part’s current rate', () => {
    const [p1, p2] = values(st().masters.parts).filter((p) => p.unitId === 'u1')
    const a = rmRate.save({ partId: p1!.id, rate: 9, effectiveFrom: '2025-01-01' }, null)
    rmRate.save({ partId: p2!.id, rate: 11, effectiveFrom: '2025-06-01' }, null)

    expect(getById(st().masters.rmRates, a.data.id)!.supersededAt).toBeUndefined()
  })

  it('leaves an already-superseded older rate untouched (keeps its original date)', () => {
    const part = u1Part()
    const r1 = rmRate.save({ partId: part.id, rate: 10, effectiveFrom: '2025-01-01' }, null)
    rmRate.save({ partId: part.id, rate: 12, effectiveFrom: '2025-06-01' }, null)
    rmRate.save({ partId: part.id, rate: 13, effectiveFrom: '2025-09-01' }, null)

    // r1 was superseded by the June rate and must NOT be re-stamped by the September one.
    expect(getById(st().masters.rmRates, r1.data.id)!.supersededAt).toBe('2025-06-01')
  })

  it('production rate supersede is scoped to part + machine + operation', () => {
    const part = u1Part()
    const machine = u1Machine()
    const op = anOperation()
    const sameKey = prodRate.save(
      { partId: part.id, machineId: machine.id, operationId: op.id, rate: 5, effectiveFrom: '2025-01-01' },
      null
    )
    // Different operation ⇒ a different rate lane ⇒ must NOT supersede.
    const otherKey = prodRate.save(
      { partId: part.id, machineId: machine.id, operationId: '', rate: 6, effectiveFrom: '2025-01-01' },
      null
    )
    // Same key, newer ⇒ supersedes the first.
    prodRate.save(
      { partId: part.id, machineId: machine.id, operationId: op.id, rate: 7, effectiveFrom: '2025-06-01' },
      null
    )

    expect(getById(st().masters.productionRates, sameKey.data.id)!.supersededAt).toBe('2025-06-01')
    expect(getById(st().masters.productionRates, otherKey.data.id)!.supersededAt).toBeUndefined()
  })

  it('latestProductionRate is POINT-IN-TIME: a superseded rate still applies to back-dated work', () => {
    const part = u1Part()
    // ₹5 from Jan, ₹7 from Jun (which supersedes the Jan rate at 2025-06-01).
    prodRate.save({ partId: part.id, machineId: '', operationId: '', rate: 5, effectiveFrom: '2025-01-01' }, null)
    prodRate.save({ partId: part.id, machineId: '', operationId: '', rate: 7, effectiveFrom: '2025-06-01' }, null)

    // A back-dated entry (Mar) must resolve to the Jan rate even though it's now superseded.
    expect(latestProductionRate(st(), part.id, undefined, undefined, '2025-03-15')).toBe(toPaise(5))
    // On/after Jun → the new rate.
    expect(latestProductionRate(st(), part.id, undefined, undefined, '2025-07-01')).toBe(toPaise(7))
    // Before any rate was effective → none.
    expect(latestProductionRate(st(), part.id, undefined, undefined, '2024-12-01')).toBeUndefined()
  })
})
