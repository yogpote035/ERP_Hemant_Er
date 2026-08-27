/**
 * attendanceCommands.ts (plan P6) — production + shift attendance. makeQty,
 * earned, hours and wage are all DERIVED (selectors/attendance.ts); we only
 * snapshot the rate in force on the date so later rate edits don't rewrite
 * historical earnings.
 */
import type { Id, ISODate, ProductionAttendance, ShiftAttendance } from '@/types/domain'
import { formatINRSymbol, mulQty, type Paise } from '@/lib/money'
import { getById, putEntity, removeEntity } from './normalized'
import { writableUnitIds } from './scope'
import { latestProductionRate, minutesBetween } from '@/selectors/attendance'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

// ── production ─────────────────────────────────────────────────────────────────
export interface ProductionInput {
  id?: Id
  /** Derived from the chosen employee (the form no longer asks for a unit). */
  unitId: Id
  date: ISODate
  shiftNo?: string
  employeeId: Id
  machineId: Id
  partId: Id
  operationId?: Id
  /** "Standard" / "Plan" planning readings. */
  standard: number
  plan: number
  /** Total pieces made; OK + Scrap + Rework + MF must reconcile to it. */
  totalMakeQty: number
  okQty: number
  scrapQty?: number
  reworkQty?: number
  mfQty?: number
  downtimeFrom?: string
  downtimeTo?: string
  remark?: string
}

function validateProduction(s: RootState, input: ProductionInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  const emp = getById(s.masters.employees, input.employeeId)
  const mc = getById(s.masters.machines, input.machineId)
  const part = getById(s.masters.parts, input.partId)
  if (!emp) errors.push('Employee is required')
  if (!mc) errors.push('Machine is required')
  if (!part) errors.push('Part is required')
  // Unit is derived from the employee, so the machine + part must belong to it.
  if (mc && mc.unitId !== input.unitId) errors.push("Machine belongs to a different unit than the employee")
  if (part && part.unitId !== input.unitId) errors.push("Part belongs to a different unit than the employee")
  const ok = input.okQty
  const scrap = input.scrapQty ?? 0
  const rework = input.reworkQty ?? 0
  const mf = input.mfQty ?? 0
  if (input.totalMakeQty < 0) errors.push('Total make qty cannot be negative')
  if (ok < 0 || scrap < 0 || rework < 0 || mf < 0) errors.push('Production quantities cannot be negative')
  const breakdown = ok + scrap + rework + mf
  if (breakdown > input.totalMakeQty) {
    errors.push(`OK + Scrap + Rework + MF (${breakdown.toLocaleString('en-IN')}) exceeds total made (${input.totalMakeQty.toLocaleString('en-IN')})`)
  }
  if (input.downtimeFrom && input.downtimeTo && minutesBetween(input.downtimeFrom, input.downtimeTo) <= 0) {
    errors.push('Down-time "To" must be after "From"')
  }
  if (latestProductionRate(s, input.partId, input.machineId, input.operationId, input.date) == null) {
    errors.push('No production rate is configured for this part on that date — add one in Rate Masters')
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyProduction(draft: RootState, input: ProductionInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('prod')
  const existing = input.id ? getById(draft.hr.production, input.id) : undefined
  // Preserve the original snapshot on edit; otherwise fetch the in-force rate.
  const rate =
    existing?.rateSnapshotPaise ??
    (latestProductionRate(draft, input.partId, input.machineId, input.operationId, input.date) as Paise)
  const entry: ProductionAttendance = {
    id,
    unitId: input.unitId,
    date: input.date,
    shiftNo: input.shiftNo,
    employeeId: input.employeeId,
    machineId: input.machineId,
    partId: input.partId,
    operationId: input.operationId,
    openingCounter: input.standard,
    closingCounter: input.plan,
    totalMakeQty: input.totalMakeQty,
    okQty: input.okQty,
    scrapQty: input.scrapQty,
    reworkQty: input.reworkQty,
    mfQty: input.mfQty,
    downtimeFrom: input.downtimeFrom,
    downtimeTo: input.downtimeTo,
    remark: input.remark,
    rateSnapshotPaise: rate,
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.hr.production, entry)
  const earned = mulQty(rate, input.okQty)
  const emp = getById(draft.masters.employees, input.employeeId)
  const rejects = (input.scrapQty ?? 0) + (input.reworkQty ?? 0) + (input.mfQty ?? 0)
  return {
    result: { id },
    cascade: [
      `${input.okQty.toLocaleString('en-IN')} OK pcs by ${emp?.name ?? 'operator'}`,
      ...(rejects > 0 ? [`${rejects.toLocaleString('en-IN')} scrap / rework / MF`] : []),
      `earned ${formatINRSymbol(earned)}`,
    ],
    summary: `${existing ? 'Updated' : 'Saved'} production: ${input.okQty} pcs (${emp?.name ?? 'operator'})`,
    refs: [{ type: 'employee', id: input.employeeId }],
    unitId: input.unitId,
  }
}

const prodCreate: Command<ProductionInput, { id: Id }> = { name: 'saveProductionAttendance', module: 'attendance', action: 'create', validate: validateProduction, apply: applyProduction }
const prodEdit: Command<ProductionInput, { id: Id }> = { name: 'saveProductionAttendance', module: 'attendance', action: 'edit', validate: validateProduction, apply: applyProduction }
export function runSaveProductionAttendance(input: ProductionInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? prodEdit : prodCreate, input)
}

const prodDeleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteProductionAttendance',
  module: 'attendance',
  action: 'delete',
  validate(s, input) {
    const e = getById(s.hr.production, input.id)
    if (!e) return { ok: false, errors: ['Production entry not found'] }
    if (!writableUnitIds(s).has(e.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const e = getById(draft.hr.production, input.id) as ProductionAttendance
    const emp = getById(draft.masters.employees, e.employeeId)
    removeEntity(draft.hr.production, input.id)
    return {
      result: { id: input.id },
      cascade: [`Production entry by ${emp?.name ?? 'operator'} deleted`],
      summary: `Deleted production: ${e.okQty} pcs (${emp?.name ?? 'operator'})`,
      refs: [{ type: 'employee', id: e.employeeId }],
      unitId: e.unitId,
    }
  },
}
export function runDeleteProductionAttendance(id: Id): CommandResult<{ id: Id }> {
  return runCommand(prodDeleteCmd, { id })
}

// ── shift ────────────────────────────────────────────────────────────────────
export interface ShiftInput {
  id?: Id
  unitId: Id
  date: ISODate
  shiftNo?: string
  employeeId: Id
  fromTime: string
  toTime: string
  otHours?: number
  otRatePaise?: Paise
}

function validateShift(s: RootState, input: ShiftInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  if (!getById(s.masters.employees, input.employeeId)) errors.push('Employee is required')
  if (minutesBetween(input.fromTime, input.toTime) <= 0) errors.push('To-time must be after from-time')
  // OT must never be negative — a negative rate/hours would silently REDUCE the wage.
  if (input.otHours != null && input.otHours < 0) errors.push('OT hours cannot be negative')
  if (input.otRatePaise != null && input.otRatePaise < 0) errors.push('OT rate cannot be negative')
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyShift(draft: RootState, input: ShiftInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('shift')
  const existing = input.id ? getById(draft.hr.shifts, input.id) : undefined
  const emp = getById(draft.masters.employees, input.employeeId)
  const rate = existing?.shiftRateSnapshotPaise ?? (emp?.standardShiftRatePaise ?? (0 as Paise))
  const entry: ShiftAttendance = {
    id,
    unitId: input.unitId,
    date: input.date,
    shiftNo: input.shiftNo,
    employeeId: input.employeeId,
    fromTime: input.fromTime,
    toTime: input.toTime,
    shiftRateSnapshotPaise: rate,
    otHours: input.otHours,
    otRateSnapshotPaise: input.otRatePaise,
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.hr.shifts, entry)
  return {
    result: { id },
    cascade: [`Shift ${input.fromTime}–${input.toTime} for ${emp?.name ?? 'employee'}`],
    summary: `${existing ? 'Updated' : 'Saved'} shift attendance (${emp?.name ?? 'employee'})`,
    refs: [{ type: 'employee', id: input.employeeId }],
    unitId: input.unitId,
  }
}

const shiftCreate: Command<ShiftInput, { id: Id }> = { name: 'saveShiftAttendance', module: 'attendance', action: 'create', validate: validateShift, apply: applyShift }
const shiftEdit: Command<ShiftInput, { id: Id }> = { name: 'saveShiftAttendance', module: 'attendance', action: 'edit', validate: validateShift, apply: applyShift }
export function runSaveShiftAttendance(input: ShiftInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? shiftEdit : shiftCreate, input)
}

const shiftDeleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteShiftAttendance',
  module: 'attendance',
  action: 'delete',
  validate(s, input) {
    const e = getById(s.hr.shifts, input.id)
    if (!e) return { ok: false, errors: ['Shift entry not found'] }
    if (!writableUnitIds(s).has(e.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const e = getById(draft.hr.shifts, input.id) as ShiftAttendance
    const emp = getById(draft.masters.employees, e.employeeId)
    removeEntity(draft.hr.shifts, input.id)
    return {
      result: { id: input.id },
      cascade: [`Shift entry for ${emp?.name ?? 'employee'} deleted`],
      summary: `Deleted shift attendance (${emp?.name ?? 'employee'})`,
      refs: [{ type: 'employee', id: e.employeeId }],
      unitId: e.unitId,
    }
  },
}
export function runDeleteShiftAttendance(id: Id): CommandResult<{ id: Id }> {
  return runCommand(shiftDeleteCmd, { id })
}
