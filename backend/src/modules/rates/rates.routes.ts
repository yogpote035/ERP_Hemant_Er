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
import { Router } from 'express'
import { z } from 'zod'
import { getDb, mutate } from '../../db/repository.js'
import { getById, putEntity, patchEntity, values } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { authenticate, requirePermission } from '../../auth/middleware.js'
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

function assertPartExists(partId: Id): void {
  if (!getById(getDb().masters.parts, partId)) throw badRequest(`Unknown part ${partId}`)
}

// ── RM rates ─────────────────────────────────────────────────────────────────
ratesRouter.get(
  '/rm',
  requirePermission('rates', 'view'),
  asyncHandler(async (req, res) => {
    res.json(buildList(values(getDb().masters.rmRates), req.query, (r) => genericSearchText(r as unknown as Record<string, unknown>)))
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
    assertPartExists(v.partId)

    const entity: RmRate = {
      id: genId('rm'),
      partId: v.partId,
      ratePaise: v.ratePaise as Paise,
      effectiveFrom: v.effectiveFrom,
    }

    const { row, superseded } = await mutate((s) => {
      putEntity(s.masters.rmRates, entity)
      // A new RM rate supersedes the prior current rate for the same part.
      const superseded: Id[] = []
      for (const r of values(s.masters.rmRates)) {
        if (
          r.id !== entity.id &&
          r.partId === entity.partId &&
          !r.supersededAt &&
          r.effectiveFrom <= entity.effectiveFrom
        ) {
          patchEntity(s.masters.rmRates, r.id, { supersededAt: entity.effectiveFrom })
          superseded.push(r.id)
        }
      }
      return { row: getById(s.masters.rmRates, entity.id) as RmRate, superseded }
    })

    res
      .status(201)
      .json({ data: row, cascade: superseded.map((id) => `superseded ${id}`) })
  })
)

// ── Production rates ───────────────────────────────────────────────────────────
ratesRouter.get(
  '/production',
  requirePermission('rates', 'view'),
  asyncHandler(async (req, res) => {
    res.json(buildList(values(getDb().masters.productionRates), req.query, (r) => genericSearchText(r as unknown as Record<string, unknown>)))
  })
)

ratesRouter.post(
  '/production',
  requirePermission('rates', 'create'),
  asyncHandler(async (req, res) => {
    const v = prodRateSchema.parse(req.body)
    assertPartExists(v.partId)
    if (v.machineId && !getById(getDb().masters.machines, v.machineId)) {
      throw badRequest(`Unknown machine ${v.machineId}`)
    }
    if (v.operationId && !getById(getDb().masters.operations, v.operationId)) {
      throw badRequest(`Unknown operation ${v.operationId}`)
    }

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
      // Supersede prior current rate for the same part+machine+operation key.
      const superseded: Id[] = []
      for (const r of values(s.masters.productionRates)) {
        if (
          r.id !== entity.id &&
          r.partId === entity.partId &&
          r.machineId === entity.machineId &&
          r.operationId === entity.operationId &&
          !r.supersededAt &&
          r.effectiveFrom <= entity.effectiveFrom
        ) {
          patchEntity(s.masters.productionRates, r.id, { supersededAt: entity.effectiveFrom })
          superseded.push(r.id)
        }
      }
      return { row: getById(s.masters.productionRates, entity.id) as ProductionRate, superseded }
    })

    res
      .status(201)
      .json({ data: row, cascade: superseded.map((id) => `superseded ${id}`) })
  })
)
