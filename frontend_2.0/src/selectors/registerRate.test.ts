import { describe, expect, it } from 'vitest'
import { seedState } from '@/lib/seed'
import { toPaise } from '@/lib/money'
import { emptyCollection, putEntity } from '@/store/normalized'
import { productionRateSuggestion } from './register'

describe('productionRateSuggestion', () => {
  it('prefers the effective Production Rate Master value', () => {
    const state = seedState()

    expect(productionRateSuggestion(state, 'p1', '2025-07-01')).toEqual({
      ratePaise: toPaise(3),
      source: 'rate-master',
    })
  })

  it('falls back to the latest prior billed outward rate when no master exists', () => {
    const state = seedState()
    state.masters.productionRates = emptyCollection()
    putEntity(state.inventory.dispatches, {
      id: 'dispatch-rate-fallback',
      inwardId: 'i2',
      kind: 'billed',
      okQty: 1,
      mcRejQty: 0,
      mfQty: 0,
      dispatchDate: '2025-06-30',
      rateSnapshotPaise: toPaise(9.5),
      createdBy: 'u-admin',
      createdAt: '2025-06-30T10:00:00.000Z',
    })

    expect(productionRateSuggestion(state, 'p1', '2025-07-01')).toEqual({
      ratePaise: toPaise(9.5),
      source: 'last-outward',
    })
  })

  it('does not use a future outward snapshot for a back-dated line', () => {
    const state = seedState()
    state.masters.productionRates = emptyCollection()

    expect(productionRateSuggestion(state, 'p1', '2025-01-01')).toBeUndefined()
  })
})
