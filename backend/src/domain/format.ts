/**
 * format.ts — display-string helpers the report/invoice projections need but
 * that aren't exported by the shared `lib/money.ts` / `lib/id.ts` foundation.
 * Pure (no store access); ported from the frontend's `lib/money.ts` + `lib/date.ts`.
 */
import { formatINR, type Paise } from '../lib/money.js'

/** Display format used across the app: `dd-MM-yyyy`. Empty string for unset/invalid. */
export function formatDMY(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return ''
  const dd = String(d.getDate()).padStart(2, '0')
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const yyyy = String(d.getFullYear())
  return `${dd}-${mm}-${yyyy}`
}

/** With the ₹ symbol: `₹1,53,000.00`. */
export function formatINRSymbol(p: Paise): string {
  const neg = p < 0
  return `${neg ? '-' : ''}₹${formatINR(Math.abs(p) as Paise)}`
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
