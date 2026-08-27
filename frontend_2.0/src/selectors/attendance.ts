/**
 * attendance.ts (plan P6) — payroll reads, all DERIVED.
 *   production: makeQty = closing − opening; earned = okQty × rate (snapshot)
 *   shift:      hours = toTime − fromTime; wage = hours/8 × shiftRate (+ OT)
 */
import type { Id, ISODate, ProductionAttendance, ShiftAttendance } from '@/types/domain'
import { addP, mulQty, type Paise } from '@/lib/money'
import { values, getById } from '@/store/normalized'
import type { RootState } from '@/store/state'
import { allowedUnitIds } from '@/store/scope'

const ZERO = 0 as Paise

/** Pieces made on a production entry. Explicit `totalMakeQty` wins; legacy rows
 *  fall back to the old counter delta (closing − opening). */
export const makeQty = (a: ProductionAttendance): number =>
  a.totalMakeQty ?? Math.max(0, a.closingCounter - a.openingCounter)
/** Earned amount on a production entry (okQty × snapshot rate). */
export const productionEarned = (a: ProductionAttendance): Paise => mulQty(a.rateSnapshotPaise, a.okQty)

/** Closing counter of the most recent production entry for a (machine, part) — the
 *  basis for auto-filling the next Standard counter (= last Plan + 1). Excludes the
 *  row being edited. Null when there's no prior entry. */
export function lastProductionClosingCounter(
  s: RootState,
  machineId: Id,
  partId: Id,
  excludeId?: Id
): number | null {
  let best: ProductionAttendance | null = null
  for (const p of values(s.hr.production)) {
    if (p.machineId !== machineId || p.partId !== partId || p.id === excludeId) continue
    if (!best || p.date > best.date || (p.date === best.date && p.createdAt > best.createdAt)) best = p
  }
  return best ? best.closingCounter : null
}

/** Minutes between two `HH:mm` times (same day; 0 if malformed or reversed). */
export function minutesBetween(from: string, to: string): number {
  const p = (t: string) => {
    const parts = t.split(':')
    const h = Number(parts[0])
    const m = Number(parts[1])
    return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : NaN
  }
  const a = p(from)
  const b = p(to)
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0
  return b - a
}
export const shiftHours = (a: ShiftAttendance): number => minutesBetween(a.fromTime, a.toTime) / 60

/** Down-time minutes on a production entry (0 when the window is unset/invalid). */
export const downtimeMins = (a: ProductionAttendance): number =>
  a.downtimeFrom && a.downtimeTo ? minutesBetween(a.downtimeFrom, a.downtimeTo) : 0

/** Shift wage = (hours/8) × shiftRate + OT hours × OT rate, rounded to paise. */
export function shiftWage(a: ShiftAttendance): Paise {
  const base = Math.round((shiftHours(a) / 8) * a.shiftRateSnapshotPaise) as Paise
  const ot = a.otHours && a.otRateSnapshotPaise ? (Math.round(a.otHours * a.otRateSnapshotPaise) as Paise) : ZERO
  return addP(base, ot)
}

/**
 * Auto-fetch the production rate valid ON a date for (part, machine, operation).
 * A rate with a null machine/operation is a wildcard; more specific wins, then
 * the most recent effectiveFrom. POINT-IN-TIME: a superseded rate is still the
 * correct one for dates before its successor took effect (supersededAt holds the
 * successor's effectiveFrom), so we must NOT drop superseded rates outright — that
 * would make back-dated production for any pre-revision date unratable.
 */
export function latestProductionRate(
  s: RootState,
  partId: Id,
  machineId: Id | undefined,
  operationId: Id | undefined,
  onDate: ISODate
): Paise | undefined {
  const candidates = values(s.masters.productionRates)
    .filter((r) => r.partId === partId && r.effectiveFrom <= onDate && (!r.supersededAt || onDate < r.supersededAt))
    .filter((r) => (r.machineId ? r.machineId === machineId : true))
    .filter((r) => (r.operationId ? r.operationId === operationId : true))
    .map((r) => ({ r, score: (r.machineId ? 2 : 0) + (r.operationId ? 1 : 0) }))
    .sort((a, b) => b.score - a.score || b.r.effectiveFrom.localeCompare(a.r.effectiveFrom))
  return candidates[0]?.r.ratePaise
}

export interface ProductionRow {
  entry: ProductionAttendance
  employeeName: string
  machineNo: string
  partNo: string
  makeQty: number
  downtimeMins: number
  earned: Paise
}
export function selectProductionRows(s: RootState): ProductionRow[] {
  const allowed = allowedUnitIds(s)
  return values(s.hr.production)
    .filter((a) => allowed.has(a.unitId))
    .map((a) => ({
      entry: a,
      employeeName: getById(s.masters.employees, a.employeeId)?.name ?? '—',
      machineNo: getById(s.masters.machines, a.machineId)?.machineNo ?? '—',
      partNo: getById(s.masters.parts, a.partId)?.partNo ?? '—',
      makeQty: makeQty(a),
      downtimeMins: downtimeMins(a),
      earned: productionEarned(a),
    }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date))
}

export interface ShiftRow {
  entry: ShiftAttendance
  employeeName: string
  hours: number
  wage: Paise
}
export function selectShiftRows(s: RootState): ShiftRow[] {
  const allowed = allowedUnitIds(s)
  return values(s.hr.shifts)
    .filter((a) => allowed.has(a.unitId))
    .map((a) => ({
      entry: a,
      employeeName: getById(s.masters.employees, a.employeeId)?.name ?? '—',
      hours: shiftHours(a),
      wage: shiftWage(a),
    }))
    .sort((a, b) => b.entry.date.localeCompare(a.entry.date))
}

export interface EarningRow {
  employeeId: Id
  employeeName: string
  productionEarned: Paise
  shiftWage: Paise
  total: Paise
}
/**
 * Per-employee earnings across both methods (scoped), optionally restricted to a
 * `[from, to]` date window (inclusive; either bound may be omitted). Empty window
 * ⇒ all-time, so `selectEarnings` is just the unbounded case (used by Reports).
 */
export function selectEarningsBetween(s: RootState, from?: ISODate, to?: ISODate): EarningRow[] {
  const inRange = (d: ISODate) => (!from || d >= from) && (!to || d <= to)
  const map = new Map<Id, EarningRow>()
  const get = (id: Id): EarningRow => {
    let r = map.get(id)
    if (!r) {
      r = { employeeId: id, employeeName: getById(s.masters.employees, id)?.name ?? '—', productionEarned: ZERO, shiftWage: ZERO, total: ZERO }
      map.set(id, r)
    }
    return r
  }
  for (const row of selectProductionRows(s)) {
    if (!inRange(row.entry.date)) continue
    const r = get(row.entry.employeeId)
    r.productionEarned = addP(r.productionEarned, row.earned)
    r.total = addP(r.total, row.earned)
  }
  for (const row of selectShiftRows(s)) {
    if (!inRange(row.entry.date)) continue
    const r = get(row.entry.employeeId)
    r.shiftWage = addP(r.shiftWage, row.wage)
    r.total = addP(r.total, row.wage)
  }
  return [...map.values()].sort((a, b) => b.total - a.total)
}

/** All-time per-employee earnings (used by the Reports register). */
export function selectEarnings(s: RootState): EarningRow[] {
  return selectEarningsBetween(s)
}
