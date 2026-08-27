import { describe, it, expect } from 'vitest'
import {
  toPaise,
  fromPaise,
  addP,
  mulQty,
  pctOfPaise,
  roundToRupee,
  roundOffDelta,
  splitGst,
  formatINR,
  toWordsIndian,
  type Paise,
} from './money'

const P = (n: number) => n as Paise

describe('money — float-drift absorption', () => {
  it('absorbs the real register drift to clean paise', () => {
    expect(toPaise(61301.99999999999)).toBe(6130200)
    expect(toPaise(7356.239999999999)).toBe(735624)
  })

  it('GST on a drifted base recomputes exactly (no 7356.2399… leak)', () => {
    // 12% IGST on ₹61,302.00
    expect(pctOfPaise(P(6130200), 12)).toBe(735624)
  })
})

describe('money — Indian grouping display', () => {
  it.each([
    [15300000, '1,53,000.00'],
    [6130200, '61,302.00'],
    [100, '1.00'],
    [0, '0.00'],
    [123456789, '12,34,567.89'],
    [-15300000, '-1,53,000.00'],
  ])('formatINR(%i) === %s', (paise, str) => {
    expect(formatINR(P(paise))).toBe(str)
  })
})

describe('money — rounding & round-off', () => {
  it('roundToRupee + roundOffDelta reconstruct the original', () => {
    for (const v of [6130266, 6130233, 6130250, 6130299, 100]) {
      expect(roundToRupee(P(v)) - roundOffDelta(P(v))).toBe(v)
    }
  })
  it('round-off delta stays in [-49, 50] (half-up)', () => {
    for (const v of [6130266, 6130233, 6130250, 6130201, 6130299]) {
      const d = roundOffDelta(P(v))
      expect(d).toBeGreaterThanOrEqual(-49)
      expect(d).toBeLessThanOrEqual(50)
    }
  })
})

describe('money — CGST/SGST split (odd paisa -> CGST)', () => {
  it('inter-state -> all IGST', () => {
    const s = splitGst(P(735625), true)
    expect(s).toEqual({ igst: 735625, cgst: 0, sgst: 0, total: 735625 })
  })
  it('intra-state odd total puts the extra paisa on CGST and still sums', () => {
    const s = splitGst(P(735625), false)
    expect(s.cgst).toBe(367813) // ceil(735625 / 2)
    expect(s.sgst).toBe(367812)
    expect(s.cgst + s.sgst).toBe(735625)
    expect(s.igst).toBe(0)
  })
  it('intra-state even total splits evenly', () => {
    const s = splitGst(P(735624), false)
    expect(s.cgst).toBe(367812)
    expect(s.sgst).toBe(367812)
  })
})

describe('money — the real scrap-bill chain (TCS)', () => {
  it('7117 kg × ₹34.5 → IGST 18% → TCS 1% reconciles to 2,92,630.40', () => {
    const ratePerKg = toPaise(34.5) // 3450
    const value = mulQty(ratePerKg, 7117) // 24553650
    const igst = pctOfPaise(value, 18) // 4419657
    const total = addP(value, igst) // 28973307
    const tcs = pctOfPaise(total, 1) // 289733
    const grand = addP(total, tcs) // 29263040
    expect(value).toBe(24553650)
    expect(igst).toBe(4419657)
    expect(total).toBe(28973307)
    expect(tcs).toBe(289733)
    expect(grand).toBe(29263040)
    expect(formatINR(grand)).toBe('2,92,630.40')
  })
})

describe('money — amount in words (Indian)', () => {
  it('renders Lakh/Crore vocabulary ending in Only', () => {
    expect(toWordsIndian(P(15300000))).toBe('Rupees One Lakh Fifty Three Thousand Only')
    expect(toWordsIndian(P(6130200))).toBe('Rupees Sixty One Thousand Three Hundred Two Only')
  })
  it('appends a paise tail only when non-zero', () => {
    expect(toWordsIndian(P(29263040))).toBe(
      'Rupees Two Lakh Ninety Two Thousand Six Hundred Thirty and Forty Paise Only'
    )
  })
})

describe('money — fromPaise', () => {
  it('is display-only inverse', () => {
    expect(fromPaise(P(6130200))).toBe(61302)
  })
})
