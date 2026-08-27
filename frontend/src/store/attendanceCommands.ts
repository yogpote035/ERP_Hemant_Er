/**
 * attendanceCommands.ts (plan P6) — production + shift attendance. makeQty,
 * earned, hours and wage are all DERIVED (selectors/attendance.ts); we only
 * snapshot the rate in force on the date so later rate edits don't rewrite
 * historical earnings.
 */
import type { Id, ISODate, ProductionAttendance, ShiftAttendance } from '@/types/domain'
import { formatINRSymbol, mulQty, type Paise } from '@/lib/money'
import { getById, putEntity } from './normalized'
import { writableUnitIds } from './scope'
import { latestProductionRate, minutesBetween } from '@/selectors/attendance'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

// ── production ─────────────────────────────────────────────────────────────────
export interface ProductionInput {
  id?: Id
  unitId: Id
  date: ISODate
  shift?: string
  employeeId: Id
  machineId: Id
  partId: Id
  operationId?: Id
  openingCounter: number
  closingCounter: number
  okQty: number
  downtimeCode?: string
  downtimeRemarks?: string
}

function validateProduction(s: RootState, input: ProductionInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  if (!getById(s.masters.employees, input.employeeId)) errors.push('Employee is required')
  if (!getById(s.masters.machines, input.machineId)) errors.push('Machine is required')
  if (!getById(s.masters.parts, input.partId)) errors.push('Part is required')
  const make = input.closingCounter - input.openingCounter
  if (make < 0) errors.push('Closing counter is below the opening counter')
  if (input.okQty < 0) errors.push('OK qty cannot be negative')
  if (input.okQty > make) errors.push(`OK qty (${input.okQty}) exceeds pieces made (${make})`)
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
    shift: input.shift,
    employeeId: input.employeeId,
    machineId: input.machineId,
    partId: input.partId,
    operationId: input.operationId,
    openingCounter: input.openingCounter,
    closingCounter: input.closingCounter,
    okQty: input.okQty,
    downtimeCode: input.downtimeCode,
    downtimeRemarks: input.downtimeRemarks,
    rateSnapshotPaise: rate,
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.hr.production, entry)
  const earned = mulQty(rate, input.okQty)
  const emp = getById(draft.masters.employees, input.employeeId)
  return {
    result: { id },
    cascade: [
      `${input.okQty.toLocaleString('en-IN')} OK pcs by ${emp?.name ?? 'operator'}`,
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
