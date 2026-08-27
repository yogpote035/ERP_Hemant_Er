/**
 * money.ts — integer-paise money model, ported verbatim from the frontend so the
 * server computes invoice/scrap/payroll money byte-identically to the UI.
 * All monetary values are integer **paise** (a branded number).
 */

export type Paise = number & { readonly __brand: 'paise' }

const asPaise = (n: number): Paise => n as Paise

/** Rupees (possibly float-drifted) -> exact integer paise. */
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

/** `pct` percent of a paise base. */
export function pctOfPaise(base: Paise, pct: number): Paise {
  return asPaise(Math.round((base * pct) / 100))
}

/** Round paise to the nearest whole rupee. */
export function roundToRupee(p: Paise): Paise {
  return asPaise(Math.round(p / 100) * 100)
}

/** Signed round-off delta in [-49, +50] paise (half-up). */
export function roundOffDelta(p: Paise): Paise {
  return asPaise(roundToRupee(p) - p)
}

export interface GstSplit {
  igst: Paise
  cgst: Paise
  sgst: Paise
  total: Paise
}

/** Split a total GST amount: inter-state -> all IGST; intra-state -> CGST+SGST (odd paisa to CGST). */
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
