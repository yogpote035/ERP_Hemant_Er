import { describe, it, expect } from 'vitest'
import { seedState } from '@/lib/seed'
import { selectReconcile } from './reconcile'

/**
 * P9 reconcile gate. The seeded demo state must be perfectly balanced: every
 * part ledger reconciles (inward = dispatch + stock + scrap, no orphan
 * dispatches). If a future change to the seed or the reconcile invariants
 * (I1-I3 / I5) introduces an imbalance, this fails loudly instead of shipping a
 * red reconcile badge to the user.
 */
describe('reconcile gate', () => {
  it('seed data reconciles GREEN (zero imbalances)', () => {
    const result = selectReconcile(seedState())
    // Surface the offending ledgers in the failure message, not just a count.
    expect(result.ledgers.filter((l) => !l.balanced).map((l) => l.partId)).toEqual([])
    expect(result.orphanDispatchIds).toEqual([])
    expect(result.redCount).toBe(0)
    expect(result.ok).toBe(true)
  })
})
