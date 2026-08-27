import { describe, it, expect } from 'vitest'
import { computeScrap } from './scrapMath'
import { toPaise } from './money'

describe('computeScrap', () => {
  it('matches the plan acceptance figure (7117 kg @ 34.50, 18% GST, 1% TCS)', () => {
    const m = computeScrap(7117 * 1000, toPaise(34.5), 18, 1)
    expect(m.value).toBe(24553650)
    expect(m.gst).toBe(4419657)
    expect(m.base).toBe(28973307)
    expect(m.tcs).toBe(289733)
    expect(m.grand).toBe(29263040)
  })

  it('is zero for zero weight', () => {
    const m = computeScrap(0, toPaise(34.5), 18, 1)
    expect(m.grand).toBe(0)
  })
})
