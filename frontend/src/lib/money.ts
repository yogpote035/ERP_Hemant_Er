/**
 * money.ts — the ONE place rupee <-> paise conversion happens.
 *
 * All monetary values in the store are integer **paise** (a branded number).
 * Real client data shows float drift (e.g. Total Amount `61301.99999999999`,
 * IGST `7356.239999999999`); integer paise + "round only at display" is the
 * only decimal-safe approach. A lint/grep gate forbids `*100` / `/100` outside
 * this file.
 *
 * Max realistic invoice ≈ ₹1 crore = 1e9 paise, far under Number.MAX_SAFE_INTEGER
 * (9.007e15), so plain `number` arithmetic on paise is exact.
 */

export type Paise = number & { readonly __brand: 'paise' }

const asPaise = (n: number): Paise => n as Paise

/** Rupees (possibly float-drifted) -> exact integer paise. `toPaise(61301.99999999999) === 6130200`. */
export function toPaise(rupees: number): Paise {
  return asPaise(Math.round(rupees * 100))
}

/** Paise -> rupees number (for display formatting only). */
export function fromPaise(p: Paise): number {
  return p / 100
}

export function addP(...xs: Paise[]): Paise {
  return asPaise(xs.reduce((a, b) => a + b, 0))
}

export function subP(a: Paise, b: Paise): Paise {
  return asPaise(a - b)
}

/** Unit price in paise × integer quantity -> paise. */
export function mulQty(unitPaise: Paise, qty: number): Paise {
  return asPaise(Math.round(unitPaise * qty))
}

/** `pct` percent of a paise base, e.g. `pctOfPaise(6130200, 12) === 735624`. */
export function pctOfPaise(base: Paise, pct: number): Paise {
  return asPaise(Math.round((base * pct) / 100))
}

/** Round paise to the nearest whole rupee. */
export function roundToRupee(p: Paise): Paise {
  return asPaise(Math.round(p / 100) * 100)
}

/** Signed round-off delta in [-49, +50] paise (half-up): `roundToRupee(p) - p`. */
export function roundOffDelta(p: Paise): Paise {
  return asPaise(roundToRupee(p) - p)
}

export interface GstSplit {
  igst: Paise
  cgst: Paise
  sgst: Paise
  total: Paise
}

/**
 * Split a total GST amount.
 *  - inter-state  -> all IGST (CGST/SGST zero)
 *  - intra-state  -> CGST + SGST, with the odd paisa assigned to **CGST**
 *    (Indian convention); cgst + sgst === total to the paise.
 */
export function splitGst(totalTax: Paise, interState: boolean): GstSplit {
  if (interState) {
    return { igst: totalTax, cgst: asPaise(0), sgst: asPaise(0), total: totalTax }
  }
  const cgst = asPaise(Math.ceil(totalTax / 2))
  const sgst = asPaise(totalTax - cgst)
  return { igst: asPaise(0), cgst, sgst, total: totalTax }
}

/** Indian-grouped display from paise: `formatINR(15300000) === '1,53,000.00'`. */
export function formatINR(p: Paise): string {
  const neg = p < 0
  const n = Math.abs(p)
  const rupees = Math.floor(n / 100)
  const paise = n % 100
  const s = String(rupees)
  let grouped: string
  if (s.length <= 3) {
    grouped = s
  } else {
    const last3 = s.slice(-3)
    const rest = s.slice(0, -3)
    grouped = rest.replace(/\B(?=(\d\d)+(?!\d))/g, ',') + ',' + last3
  }
  return `${neg ? '-' : ''}${grouped}.${String(paise).padStart(2, '0')}`
}

/** With the ₹ symbol: `₹1,53,000.00`. */
export function formatINRSymbol(p: Paise): string {
  const neg = p < 0
  return `${neg ? '-' : ''}₹${formatINR(asPaise(Math.abs(p)))}`
}

// ── Amount in words (Indian numbering) ───────────────────────────────────────

const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten',
  'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen',
  'Eighteen', 'Nineteen',
]
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety']

function twoDigitsToWords(n: number): string {
  if (n < 20) return ONES[n] ?? ''
  const t = Math.floor(n / 10)
  const o = n % 10
  return `${TENS[t] ?? ''}${o ? ' ' + ONES[o] : ''}`
}

function threeDigitsToWords(n: number): string {
  const h = Math.floor(n / 100)
  const rest = n % 100
  const parts: string[] = []
  if (h) parts.push(`${ONES[h]} Hundred`)
  if (rest) parts.push(twoDigitsToWords(rest))
  return parts.join(' ')
}

/** Whole-rupee integer -> Indian-system words (Crore/Lakh/Thousand). */
function rupeesToWords(num: number): string {
  if (num === 0) return 'Zero'
  const crore = Math.floor(num / 10000000)
  num %= 10000000
  const lakh = Math.floor(num / 100000)
  num %= 100000
  const thousand = Math.floor(num / 1000)
  num %= 1000
  const hundreds = num

  const parts: string[] = []
  if (crore) parts.push(`${rupeesToWords(crore)} Crore`)
  if (lakh) parts.push(`${twoDigitsToWords(lakh)} Lakh`)
  if (thousand) parts.push(`${twoDigitsToWords(thousand)} Thousand`)
  if (hundreds) parts.push(threeDigitsToWords(hundreds))
  return parts.join(' ').trim()
}

/**
 * Amount-in-words for invoices: `Rupees <words> Only`, with a paise tail only
 * when non-zero. Pass the post-`roundToRupee` value for whole-rupee invoices.
 */
export function toWordsIndian(p: Paise): string {
  const neg = p < 0
  const n = Math.abs(p)
  const rupees = Math.floor(n / 100)
  const paise = n % 100
  const head = `Rupees ${rupeesToWords(rupees)}`
  const tail = paise > 0 ? ` and ${twoDigitsToWords(paise)} Paise` : ''
  return `${neg ? 'Minus ' : ''}${head}${tail} Only`
}
