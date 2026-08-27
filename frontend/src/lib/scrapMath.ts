/**
 * scrapMath.ts — scrap-sale money (plan P5). Value -> GST -> TCS @ 1% on
 * (value + GST) -> grand. All integer paise. Weight is integer grams so
 * `value = ratePerKg × kg` stays exact.
 *
 * Acceptance (plan §6): 7117 kg @ ₹34.50, 18% GST, 1% TCS =>
 *   value 24,553,650 · gst 4,419,657 · tcs 289,733 · grand 29,263,040 (paise).
 */
import { addP, pctOfPaise, type Paise } from './money'

export interface ScrapMath {
  value: Paise
  gst: Paise
  /** value + gst (the TCS base). */
  base: Paise
  tcs: Paise
  grand: Paise
}

export function computeScrap(weightGrams: number, ratePerKgPaise: Paise, gstPct: number, tcsPct: number): ScrapMath {
  const value = Math.round((ratePerKgPaise * weightGrams) / 1000) as Paise
  const gst = pctOfPaise(value, gstPct)
  const base = addP(value, gst)
  const tcs = pctOfPaise(base, tcsPct)
  const grand = addP(base, tcs)
  return { value, gst, base, tcs, grand }
}
