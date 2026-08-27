import { format, isValid, parse } from 'date-fns'

/** Display format used across the app: `dd-MM-yyyy`. */
export function formatDMY(iso: string | Date | null | undefined): string {
  if (!iso) return ''
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return isValid(d) ? format(d, 'dd-MM-yyyy') : ''
}

/** A `Date` -> `yyyy-MM-dd` ISO date string (no time). */
export function toISODate(d: Date): string {
  return format(d, 'yyyy-MM-dd')
}

/** Today as `yyyy-MM-dd`. */
export function todayISO(): string {
  return toISODate(new Date())
}

const FLEX_FORMATS = ['dd.MM.yyyy', 'dd-MM-yyyy', 'dd/MM/yyyy', 'd.M.yyyy', 'yyyy-MM-dd']

/**
 * Parse the messy date shapes the real MIO register uses (dd-first Indian
 * convention, dot-separated like `09.01.2025`) plus Excel serials. Returns a
 * `yyyy-MM-dd` string or `null` when unparseable.
 */
export function parseFlexibleDate(v: unknown): string | null {
  if (v == null || v === '') return null
  if (v instanceof Date) return isValid(v) ? toISODate(v) : null
  if (typeof v === 'number') {
    // Excel serial date: days since 1899-12-30 (accounts for the 1900 leap bug).
    const ms = Math.round((v - 25569) * 86400 * 1000)
    const d = new Date(ms)
    return isValid(d) ? toISODate(d) : null
  }
  const s = String(v).trim()
  for (const fmt of FLEX_FORMATS) {
    const d = parse(s, fmt, new Date())
    if (isValid(d)) return toISODate(d)
  }
  return null
}
