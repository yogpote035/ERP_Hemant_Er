/**
 * attendance.routes.ts (phase 2 — module: attendance)
 *
 * Production + shift attendance plus a derived per-employee payroll summary.
 * Ported faithfully from the frontend:
 *   - src/store/attendanceCommands.ts  (save / delete production + shift)
 *   - src/selectors/attendance.ts      (earned / wage derivations)
 *
 * makeQty, earned, hours and wage are all DERIVED (domain/attendance.ts); we only
 * snapshot the rate in force on the date so later rate edits don't rewrite history.
 * Session/scope (writableUnitIds / allowedUnitIds) is replaced by the route-layer
 * req.auth scope (assertUnit + an explicit Set<Id> | null for the selectors).
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { genId, nowISO } from '../../lib/id.js'
import type { Paise } from '../../lib/money.js'
import type { Id, ProductionAttendance, ShiftAttendance } from '../../types/domain.js'
import type { RootState } from '../../db/state.js'
import {
  latestProductionRate,
  minutesBetween,
  selectProductionRows,
  selectShiftRows,
  selectEarningsBetween,
} from '../../domain/attendance.js'
import { buildList, cursorList } from '../../lib/list.js'

export const attendanceRouter = Router()
attendanceRouter.use(authenticate)

/** allowedUnitIds (string[] | null) -> Set<Id> | null for the ported selectors. */
function scope(req: Request): Set<Id> | null {
  const allowed = req.auth?.allowedUnitIds
  return allowed == null ? null : new Set(allowed)
}

// ── production ───────────────────────────────────────────────────────────────
const productionSchema = z.object({
  id: z.string().optional(),
  // Unit is derived from the chosen employee in the UI, but the API takes it
  // explicitly; the machine + part must belong to it (validated below).
  unitId: z.string(),
  date: z.string(),
  shiftNo: z.string().optional(),
  employeeId: z.string(),
  machineId: z.string(),
  partId: z.string(),
  operationId: z.string().optional(),
  standard: z.number(),
  plan: z.number(),
  totalMakeQty: z.number().int(),
  okQty: z.number().int(),
  scrapQty: z.number().int().optional(),
  reworkQty: z.number().int().optional(),
  mfQty: z.number().int().optional(),
  downtimeFrom: z.string().optional(),
  downtimeTo: z.string().optional(),
  remark: z.string().optional(),
})
type ProductionInput = z.infer<typeof productionSchema>

/** Replicates validateProduction from attendanceCommands.ts (unit access is enforced
 *  by assertUnit at the route layer, so the access check is dropped here). */
function validateProduction(s: RootState, input: ProductionInput): string[] {
  const errors: string[] = []
  const emp = getById(s.masters.employees, input.employeeId)
  const mc = getById(s.masters.machines, input.machineId)
  const part = getById(s.masters.parts, input.partId)
  if (!emp) errors.push('Employee is required')
  if (!mc) errors.push('Machine is required')
  if (!part) errors.push('Part is required')
  if (mc && mc.unitId !== input.unitId) errors.push('Machine belongs to a different unit than the employee')
  if (part && part.unitId !== input.unitId) errors.push('Part belongs to a different unit than the employee')
  const ok = input.okQty
  const scrap = input.scrapQty ?? 0
  const rework = input.reworkQty ?? 0
  const mf = input.mfQty ?? 0
  if (input.totalMakeQty < 0) errors.push('Total make qty cannot be negative')
  if (ok < 0 || scrap < 0 || rework < 0 || mf < 0) errors.push('Production quantities cannot be negative')
  const breakdown = ok + scrap + rework + mf
  if (breakdown > input.totalMakeQty) {
    errors.push(
      `OK + Scrap + Rework + MF (${breakdown.toLocaleString('en-IN')}) exceeds total made (${input.totalMakeQty.toLocaleString('en-IN')})`
    )
  }
  if (input.downtimeFrom && input.downtimeTo && minutesBetween(input.downtimeFrom, input.downtimeTo) <= 0) {
    errors.push('Down-time "To" must be after "From"')
  }
  if (latestProductionRate(s, input.partId, input.machineId, input.operationId, input.date) == null) {
    errors.push('No production rate is configured for this part on that date — add one in Rate Masters')
  }
  return errors
}

attendanceRouter.get(
  '/production',
  requirePermission('attendance', 'view'),
  asyncHandler(async (req, res) => {
    const rows = selectProductionRows(getDb(), scope(req))
    const searchText = (r: (typeof rows)[number]) => `${r.employeeName} ${r.partNo} ${r.machineNo}`
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.entry.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/** Spreadsheet-style production attendance: validate every row first, then save
 * the complete batch in one repository transaction (all rows or none). */
attendanceRouter.post(
  '/production/bulk',
  requirePermission('attendance', 'create'),
  asyncHandler(async (req, res) => {
    const inputs = z.array(productionSchema.omit({ id: true })).min(1).max(100).parse(req.body)
    for (const [index, input] of inputs.entries()) {
      assertUnit(req, input.unitId)
      const errors = validateProduction(getDb(), input)
      if (errors.length) throw badRequest(`Row ${index + 1}: ${errors.join('; ')}`, errors)
    }
    const created = await mutate((state) => inputs.map((input) => {
      const id = genId('prod')
      const rate = latestProductionRate(state, input.partId, input.machineId, input.operationId, input.date) as Paise
      const entry: ProductionAttendance = {
        id, unitId: input.unitId, date: input.date, shiftNo: input.shiftNo,
        employeeId: input.employeeId, machineId: input.machineId, partId: input.partId,
        operationId: input.operationId, openingCounter: input.standard,
        closingCounter: input.plan, totalMakeQty: input.totalMakeQty, okQty: input.okQty,
        scrapQty: input.scrapQty, reworkQty: input.reworkQty, mfQty: input.mfQty,
        downtimeFrom: input.downtimeFrom, downtimeTo: input.downtimeTo,
        remark: input.remark, rateSnapshotPaise: rate,
        createdBy: req.auth!.user.id, createdAt: nowISO(),
      }
      putEntity(state.hr.production, entry)
      return entry
    }))
    res.status(201).json({ data: created, cascade: [`${created.length} production entries saved`] })
  })
)

attendanceRouter.post(
  '/production',
  asyncHandler(async (req, res) => {
    const input = productionSchema.parse(req.body)
    // Save handles both create and edit; require whichever permission applies.
    // requirePermission throws forbidden() on failure (caught by asyncHandler).
    requirePermission('attendance', input.id ? 'edit' : 'create')(req, res, () => {})

    assertUnit(req, input.unitId)
    const errors = validateProduction(getDb(), input)
    if (errors.length) throw badRequest(errors.join('; '), errors)

    const existing = input.id ? getById(getDb().hr.production, input.id) : undefined
    if (input.id && !existing) throw notFound('Production entry not found')
    if (existing) assertUnit(req, existing.unitId)

    const id = input.id ?? genId('prod')
    // Preserve the original snapshot on edit; otherwise fetch the in-force rate.
    const rate =
      existing?.rateSnapshotPaise ??
      (latestProductionRate(getDb(), input.partId, input.machineId, input.operationId, input.date) as Paise)

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
      createdBy: existing?.createdBy ?? req.auth!.user.id,
      createdAt: existing?.createdAt ?? nowISO(),
    }
    const saved = await mutate((s) => {
      putEntity(s.hr.production, entry)
      return s.hr.production.byId[id]!
    })
    res.status(existing ? 200 : 201).json({ data: saved })
  })
)

attendanceRouter.delete(
  '/production/:id',
  requirePermission('attendance', 'delete'),
  asyncHandler(async (req, res) => {
    const existing = getById(getDb().hr.production, req.params.id)
    if (!existing) throw notFound('Production entry not found')
    assertUnit(req, existing.unitId)
    await mutate((s) => removeEntity(s.hr.production, req.params.id))
    res.json({ data: { id: req.params.id } })
  })
)

// ── shift ────────────────────────────────────────────────────────────────────
const shiftSchema = z.object({
  id: z.string().optional(),
  unitId: z.string(),
  date: z.string(),
  shiftNo: z.string().optional(),
  employeeId: z.string(),
  fromTime: z.string(),
  toTime: z.string(),
  otHours: z.number().optional(),
  otRatePaise: z.number().int().optional(),
})
type ShiftInput = z.infer<typeof shiftSchema>

/** Replicates validateShift from attendanceCommands.ts (unit access via assertUnit). */
function validateShift(s: RootState, input: ShiftInput): string[] {
  const errors: string[] = []
  if (!getById(s.masters.employees, input.employeeId)) errors.push('Employee is required')
  if (minutesBetween(input.fromTime, input.toTime) <= 0) errors.push('To-time must be after from-time')
  if (input.otHours != null && input.otHours < 0) errors.push('OT hours cannot be negative')
  if (input.otRatePaise != null && input.otRatePaise < 0) errors.push('OT rate cannot be negative')
  return errors
}

attendanceRouter.get(
  '/shift',
  requirePermission('attendance', 'view'),
  asyncHandler(async (req, res) => {
    const rows = selectShiftRows(getDb(), scope(req))
    const searchText = (r: (typeof rows)[number]) => r.employeeName
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.entry.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

attendanceRouter.post(
  '/shift',
  asyncHandler(async (req, res) => {
    const input = shiftSchema.parse(req.body)
    // requirePermission throws forbidden() on failure (caught by asyncHandler).
    requirePermission('attendance', input.id ? 'edit' : 'create')(req, res, () => {})

    assertUnit(req, input.unitId)
    const errors = validateShift(getDb(), input)
    if (errors.length) throw badRequest(errors.join('; '), errors)

    const existing = input.id ? getById(getDb().hr.shifts, input.id) : undefined
    if (input.id && !existing) throw notFound('Shift entry not found')
    if (existing) assertUnit(req, existing.unitId)

    const id = input.id ?? genId('shift')
    const emp = getById(getDb().masters.employees, input.employeeId)
    // Preserve the original snapshot on edit; otherwise snapshot the employee's rate.
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
      otRateSnapshotPaise: input.otRatePaise as Paise | undefined,
      createdBy: existing?.createdBy ?? req.auth!.user.id,
      createdAt: existing?.createdAt ?? nowISO(),
    }
    const saved = await mutate((s) => {
      putEntity(s.hr.shifts, entry)
      return s.hr.shifts.byId[id]!
    })
    res.status(existing ? 200 : 201).json({ data: saved })
  })
)

attendanceRouter.delete(
  '/shift/:id',
  requirePermission('attendance', 'delete'),
  asyncHandler(async (req, res) => {
    const existing = getById(getDb().hr.shifts, req.params.id)
    if (!existing) throw notFound('Shift entry not found')
    assertUnit(req, existing.unitId)
    await mutate((s) => removeEntity(s.hr.shifts, req.params.id))
    res.json({ data: { id: req.params.id } })
  })
)

// ── payroll (derived) ─────────────────────────────────────────────────────────
const payrollQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
})

attendanceRouter.get(
  '/payroll',
  requirePermission('attendance', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = payrollQuery.parse(req.query)
    const rows = selectEarningsBetween(getDb(), from, to, scope(req))
    res.json({ data: rows })
  })
)
