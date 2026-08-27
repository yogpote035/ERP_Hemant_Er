import { describe, it, expect } from 'vitest'
import { seedState } from '@/lib/seed'
import { values } from '@/store/normalized'
import { selectDashboardKpis } from './kpi'

const adminOf = (s: ReturnType<typeof seedState>) =>
  values(s.masters.users).find((u) => u.role === 'admin')!
const operatorOf = (s: ReturnType<typeof seedState>) =>
  values(s.masters.users).find((u) => u.role === 'operator')!

describe('dashboard kpis', () => {
  it('admin sees every unit and a reconciled seed', () => {
    const s = seedState()
    s.session = { currentUserId: adminOf(s).id, currentUnitId: 'ALL' }
    const k = selectDashboardKpis(s)
    expect(k.unitsInScope).toBe(7)
    expect(k.activeParts).toBeGreaterThan(0)
    expect(k.inwardsTotal).toBeGreaterThan(0)
    expect(k.dispatchesTotal).toBeGreaterThan(0)
    expect(k.piecesDispatched).toBeGreaterThan(0)
    expect(k.reconcileOk).toBe(true)
    expect(k.reconcileRed).toBe(0)
  })

  it('an operator is scoped to their assigned unit and never sees more than admin', () => {
    const s = seedState()
    const op = operatorOf(s)
    s.session = { currentUserId: op.id, currentUnitId: 'ALL' }
    const scoped = selectDashboardKpis(s)
    expect(scoped.unitsInScope).toBe(op.assignedUnitIds.length)

    s.session = { currentUserId: adminOf(s).id, currentUnitId: 'ALL' }
    const all = selectDashboardKpis(s)
    expect(scoped.inwardsTotal).toBeLessThanOrEqual(all.inwardsTotal)
    expect(scoped.unitsInScope).toBeLessThanOrEqual(all.unitsInScope)
  })

  it('no signed-in user → empty scope', () => {
    const s = seedState()
    s.session = { currentUserId: null, currentUnitId: null }
    const k = selectDashboardKpis(s)
    expect(k.unitsInScope).toBe(0)
    expect(k.inwardsTotal).toBe(0)
    expect(k.dispatchesTotal).toBe(0)
  })
})
