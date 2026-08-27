/**
 * Indian financial year helpers (Apr 1 – Mar 31).
 * FY label is `YY-YY`, e.g. a date in 2025-03 → `24-25`, in 2025-04 → `25-26`.
 * Per plan §2.10 the FY for invoice numbering comes from the bill/invoice date.
 */

function toDate(d: Date | string): Date {
  return typeof d === 'string' ? new Date(d) : d
}

/** Starting calendar year of the FY containing `d`. */
export function fyStartYear(d: Date | string): number {
  const dt = toDate(d)
  const month = dt.getMonth() // 0 = Jan … 3 = Apr
  return month >= 3 ? dt.getFullYear() : dt.getFullYear() - 1
}

/** FY label `YY-YY` for a date, e.g. `fyOf('2025-03-30') === '24-25'`. */
export function fyOf(d: Date | string): string {
  const start = fyStartYear(d)
  const a = String(start % 100).padStart(2, '0')
  const b = String((start + 1) % 100).padStart(2, '0')
  return `${a}-${b}`
}

/** Counter key for the per-(issuer, FY) running sequence. */
export function seqKey(issuerId: string, fy: string): string {
  return `${issuerId}:${fy}`
}
