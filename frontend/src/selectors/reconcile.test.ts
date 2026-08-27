import { describe, it, expect } from 'vitest'
import { seedState } from '@/lib/seed'
import { values } from '@/store/normalized'
import { selectReconcile, selectPartLedger } from './reconcile'
import { selectPartStock, selectInwardBalance, selectAvailableForInward } from './stock'

describe('seed shape', () => {
  const s = seedState()
  it('has 7 units, 13 parts, 4 users', () => {
    expect(s.masters.units.allIds).toHaveLength(7)
    expect(s.masters.parts.allIds).toHaveLength(13)
    expect(s.masters.users.allIds).toHaveLength(4)
  })

  it('golden challan 8202421273 = 1 inward(28000) + 4 children summing 28000, DC15 a rejection', () => {
    const i1 = s.inventory.inwards.byId['i1']!
    expect(i1.challanNo).toBe('8202421273')
    expect(i1.receivedQty).toBe(28000)
    const children = values(s.inventory.dispatches).filter((d) => d.inwardId === 'i1')
    expect(children).toHaveLength(4)
    const consumed = children.reduce((a, d) => a + d.okQty + d.mcRejQty + d.mfQty, 0)
    expect(consumed).toBe(28000)
    const dc15 = children.find((d) => d.billNo === 'DC15')!
    expect(dc15.kind).toBe('rejection')
    expect(dc15.okQty).toBe(0)
    expect(dc15.mcRejQty).toBe(242)
    expect(dc15.rateSnapshotPaise).toBeUndefined()
  })
})

describe('stock selectors on seed', () => {
  const s = seedState()
  it('part p3 (golden) is fully consumed → closing 0', () => {
    const st = selectPartStock(s, 'u1', 'p3')
    expect(st.received).toBe(28000)
    expect(st.consumed).toBe(28000)
    expect(st.available).toBe(0)
  })
  it('opening stock flows into the ledger (p6 +2000, p9 +1000)', () => {
    expect(selectPartStock(s, 'u1', 'p6').available).toBe(12000) // 2000 opening + 10000 received
    expect(selectPartStock(s, 'u1', 'p9').available).toBe(6000) // 1000 + 8000 - 3000
  })
  it('inward open-balance states', () => {
    expect(selectInwardBalance(s, 'i1')).toBe('Dispatched')
    expect(selectInwardBalance(s, 'i4')).toBe('In-house')
    expect(selectInwardBalance(s, 'i5')).toBe('Partial')
    expect(selectAvailableForInward(s, 'i5')).toBe(5000)
  })
})

describe('reconcile engine', () => {
  it('seeded data reconciles GREEN', () => {
    const r = selectReconcile(seedState())
    expect(r.ok).toBe(true)
    expect(r.redCount).toBe(0)
    expect(r.ledgers.every((l) => l.balanced)).toBe(true)
  })

  it('I1 — over-dispatching a challan turns it RED', () => {
    const s = seedState()
    s.inventory.dispatches.byId['d1']!.okQty = 99999 // > received 28000
    const r = selectReconcile(s)
    expect(r.ok).toBe(false)
    const led = selectPartLedger(s, 'u1', 'p3')
    expect(led.balanced).toBe(false)
    expect(led.issues.some((i) => i.code === 'overDispatch' || i.code === 'oversold')).toBe(true)
  })

  it('I3 — an orphan dispatch (bad inwardId) is flagged', () => {
    const s = seedState()
    s.inventory.dispatches.byId['d1']!.inwardId = 'does-not-exist'
    const r = selectReconcile(s)
    expect(r.ok).toBe(false)
    expect(r.orphanDispatchIds).toContain('d1')
  })

  it('I5 — a physical count mismatch is flagged', () => {
    const s = seedState()
    s.system.stockSnapshots.byId['snap1'] = {
      id: 'snap1', unitId: 'u1', partId: 'p6', asOfDate: '2025-03-31', countedQty: 11500,
    }
    s.system.stockSnapshots.allIds.push('snap1')
    const led = selectPartLedger(s, 'u1', 'p6')
    expect(led.balanced).toBe(false)
    expect(led.issues.some((i) => i.code === 'snapshotMismatch')).toBe(true)
  })

  it('I6 — a rejection advice returning more than the challan received turns it RED', () => {
    const s = seedState()
    const i1 = s.inventory.inwards.byId['i1']! // received 28000, part p3
    s.rejection.rejectionAdvices.byId['rejX'] = {
      id: 'rejX', unitId: i1.unitId, customerId: values(s.masters.customers)[0]!.id,
      partId: i1.partId, sourceInwardId: 'i1', rejDcNo: 'RX', rejDate: '2025-04-10',
      mrQty: 30000, frQty: 0, weightBasis: 'finish', weightPerRingMg: 1, totalWeightGrams: 30,
      createdBy: 'admin', createdAt: '2025-04-10',
    }
    s.rejection.rejectionAdvices.allIds.push('rejX')
    const led = selectPartLedger(s, i1.unitId, i1.partId)
    expect(led.balanced).toBe(false)
    expect(led.issues.some((i) => i.code === 'overRejection')).toBe(true)
  })
})
