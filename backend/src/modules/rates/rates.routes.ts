/**
 * Rates module — versioned RM & production rate masters.
 *
 * Ported from frontend_2.0 src/masters/registry.tsx (rmRateMaster / prodRateMaster
 * afterUpsert) and src/selectors/register.ts (latestProductionRatePaise). Each
 * create stamps `supersededAt` on the PRIOR current row(s) so only one current
 * rate exists per key (part for RM; part+machine+operation for production).
 * Superseded rows are kept for point-in-time / back-dated lookups.
 *
 * RBAC module key: 'rates'. Reads => 'view', creates => 'create'.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate } from '../../db/repository.js'
import { getById, putEntity, patchEntity, values } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit, canAccessUnit } from '../../auth/middleware.js'
import { genId, todayISO } from '../../lib/id.js'
import type { RmRate, ProductionRate, Id } from '../../types/domain.js'
import type { Paise } from '../../lib/money.js'
import { buildList, genericSearchText } from '../../lib/list.js'

export const ratesRouter = Router()

ratesRouter.use(authenticate)

// ── schemas (money is integer paise) ────────────────────────────────────────
const rmRateSchema = z.object({
  partId: z.string().min(1, 'partId is required'),
  ratePaise: z.number().int().nonnegative(),
  effectiveFrom: z.string().min(1, 'effectiveFrom is required'),
})

const prodRateSchema = z.object({
  partId: z.string().min(1, 'partId is required'),
  machineId: z.string().min(1).optional(),
  operationId: z.string().min(1).optional(),
  ratePaise: z.number().int().nonnegative(),
  effectiveFrom: z.string().min(1, 'effectiveFrom is required'),
})

function accessiblePart(req: Request, partId: Id) {
  const part = getById(getDb().masters.parts, partId)
  if (!part) throw badRequest(`Unknown part ${partId}`)
  assertUnit(req, part.unitId)
  return part
}

function rateIsVisible(req: Request, partId: Id): boolean {
  const part = getById(getDb().masters.parts, partId)
  return !!part && canAccessUnit(req, part.unitId)
}

function assertProductionDimensions(partUnitId: Id, machineId?: Id, operationId?: Id): void {
  if (machineId) {
    const machine = getById(getDb().masters.machines, machineId)
    if (!machine) throw badRequest(`Unknown machine ${machineId}`)
    if (machine.unitId !== partUnitId) throw badRequest('Machine does not belong to the part unit')
  }
  if (operationId) {
    const operation = getById(getDb().masters.operations, operationId)
    if (!operation) throw badRequest(`Unknown operation ${operationId}`)
    if (operation.unitId !== partUnitId) throw badRequest('Operation does not belong to the part unit')
  }
}

function rebuildRmTimeline(s: Parameters<Parameters<typeof mutate>[0]>[0], partId: Id): void {
  const versions = values(s.masters.rmRates)
    .filter((r) => r.partId === partId)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
  versions.forEach((rate, index) => patchEntity(s.masters.rmRates, rate.id, {
    supersededAt: versions[index + 1]?.effectiveFrom,
  }))
  const current = versions.filter((r) => r.effectiveFrom <= todayISO()).at(-1)
  const part = getById(s.masters.parts, partId)
  if (part && current) patchEntity(s.masters.parts, part.id, { rmRatePaise: current.ratePaise })
}

function rebuildProductionTimeline(
  s: Parameters<Parameters<typeof mutate>[0]>[0],
  key: Pick<ProductionRate, 'partId' | 'machineId' | 'operationId'>,
): void {
  const versions = values(s.masters.productionRates)
    .filter((r) => r.partId === key.partId && r.machineId === key.machineId && r.operationId === key.operationId)
    .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
  versions.forEach((rate, index) => patchEntity(s.masters.productionRates, rate.id, {
    supersededAt: versions[index + 1]?.effectiveFrom,
  }))
}

// ── RM rates ─────────────────────────────────────────────────────────────────
ratesRouter.get(
  '/rm',
  requirePermission('rates', 'view'),
  asyncHandler(async (req, res) => {
    const rows = values(getDb().masters.rmRates).filter((r) => rateIsVisible(req, r.partId))
    res.json(buildList(rows, req.query, (r) => genericSearchText(r as unknown as Record<string, unknown>)))
  })
)

/**
 * Current (effective-as-of-today, not superseded) RM rate for a part. Mirrors
 * latestProductionRatePaise: newest effectiveFrom <= today among non-superseded.
 */
ratesRouter.get(
  '/rm/current/:partId',
  requirePermission('rates', 'view'),
  asyncHandler(async (req, res) => {
    accessiblePart(req, req.params.partId)
    const today = todayISO()
    const row = values(getDb().masters.rmRates)
      .filter((r) => r.partId === req.params.partId && !r.supersededAt && r.effectiveFrom <= today)
      .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0]
    if (!row) throw notFound('No current RM rate for that part')
    res.json({ data: row })
  })
)

ratesRouter.post(
  '/rm',
  requirePermission('rates', 'create'),
  asyncHandler(async (req, res) => {
    const v = rmRateSchema.parse(req.body)
    accessiblePart(req, v.partId)

    const entity: RmRate = {
      id: genId('rm'),
      partId: v.partId,
      ratePaise: v.ratePaise as Paise,
      effectiveFrom: v.effectiveFrom,
    }

    const { row, superseded } = await mutate((s) => {
      putEntity(s.masters.rmRates, entity)
      rebuildRmTimeline(s, entity.partId)
      const superseded = values(s.masters.rmRates)
        .filter((r) => r.partId === entity.partId && r.id !== entity.id && r.supersededAt === entity.effectiveFrom)
        .map((r) => r.id)
      return { row: getById(s.masters.rmRates, entity.id) as RmRate, superseded }
    })

    res
      .status(201)
      .json({ data: row, cascade: superseded.map((id) => `superseded ${id}`) })
  })
)

ratesRouter.put(
  '/rm/:id',
  requirePermission('rates', 'edit'),
  asyncHandler(async (req, res) => {
    const v = rmRateSchema.parse(req.body)
    const existing = getById(getDb().masters.rmRates, req.params.id)
    if (!existing) throw notFound('RM rate version not found')
    accessiblePart(req, existing.partId)
    accessiblePart(req, v.partId)
    const updated: RmRate = {
      ...existing,
      partId: v.partId,
      ratePaise: v.ratePaise as Paise,
      effectiveFrom: v.effectiveFrom,
    }
    await mutate((s) => {
      putEntity(s.masters.rmRates, updated)
      rebuildRmTimeline(s, existing.partId)
      if (updated.partId !== existing.partId) rebuildRmTimeline(s, updated.partId)
    })
    res.json({ data: getById(getDb().masters.rmRates, updated.id) })
  })
)

// ── Production rates ───────────────────────────────────────────────────────────
ratesRouter.get(
  '/production',
  requirePermission('rates', 'view'),
  asyncHandler(async (req, res) => {
    const rows = values(getDb().masters.productionRates).filter((r) => rateIsVisible(req, r.partId))
    res.json(buildList(rows, req.query, (r) => genericSearchText(r as unknown as Record<string, unknown>)))
  })
)

ratesRouter.post(
  '/production',
  requirePermission('rates', 'create'),
  asyncHandler(async (req, res) => {
    const v = prodRateSchema.parse(req.body)
    const part = accessiblePart(req, v.partId)
    assertProductionDimensions(part.unitId, v.machineId, v.operationId)

    const entity: ProductionRate = {
      id: genId('pr'),
      partId: v.partId,
      machineId: v.machineId,
      operationId: v.operationId,
      ratePaise: v.ratePaise as Paise,
      effectiveFrom: v.effectiveFrom,
    }

    const { row, superseded } = await mutate((s) => {
      putEntity(s.masters.productionRates, entity)
      const versions = values(s.masters.productionRates)
        .filter((r) => r.partId === entity.partId && r.machineId === entity.machineId && r.operationId === entity.operationId)
        .sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom) || a.id.localeCompare(b.id))
      rebuildProductionTimeline(s, entity)
      const superseded = versions
        .filter((r) => r.id !== entity.id && getById(s.masters.productionRates, r.id)?.supersededAt === entity.effectiveFrom)
        .map((r) => r.id)
      return { row: getById(s.masters.productionRates, entity.id) as ProductionRate, superseded }
    })

    res
      .status(201)
      .json({ data: row, cascade: superseded.map((id) => `superseded ${id}`) })
  })
)

ratesRouter.put(
  '/production/:id',
  requirePermission('rates', 'edit'),
  asyncHandler(async (req, res) => {
    const v = prodRateSchema.parse(req.body)
    const existing = getById(getDb().masters.productionRates, req.params.id)
    if (!existing) throw notFound('Production rate version not found')
    accessiblePart(req, existing.partId)
    const part = accessiblePart(req, v.partId)
    assertProductionDimensions(part.unitId, v.machineId, v.operationId)

    const updated: ProductionRate = {
      ...existing,
      partId: v.partId,
      machineId: v.machineId,
      operationId: v.operationId,
      ratePaise: v.ratePaise as Paise,
      effectiveFrom: v.effectiveFrom,
    }
    await mutate((s) => {
      putEntity(s.masters.productionRates, updated)
      rebuildProductionTimeline(s, existing)
      if (
        updated.partId !== existing.partId ||
        updated.machineId !== existing.machineId ||
        updated.operationId !== existing.operationId
      ) rebuildProductionTimeline(s, updated)
    })
    res.json({ data: getById(getDb().masters.productionRates, updated.id) })
  })
)
