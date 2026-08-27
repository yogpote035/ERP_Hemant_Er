/**
 * Rejection-advice module (plan §P5) — create / read / delete rejection-advice
 * delivery challans.
 *
 * Ported from the frontend:
 *   - store/scrapCommands.ts  (runSaveRejectionAdvice → validateRejection /
 *     applyRejection; runDeleteRejectionAdvice → rejDeleteCmd)
 *
 * Each advice is a single-collection write. `totalWeightGrams` is derived from
 * the rejected ring count and the per-ring weight (the part's finish/scrap
 * weight per `weightBasis`, or an explicit override):
 *   totalWeightGrams = round((mrQty + frQty) * weightPerRingMg / 1000)
 *
 * Session/scope usage (writableUnitIds) is replaced by the route-layer auth
 * scope: `req.auth.allowedUnitIds` for reads, `assertUnit` for writes.
 */
import { Router } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { resolveId, nowISO } from '../../lib/id.js'
import type { Id, RejectionAdvice, RejectionWeightBasis } from '../../types/domain.js'
import type { RootState } from '../../db/state.js'
import { buildList, cursorList } from '../../lib/list.js'

// ── body schema (create) — ports validateRejection's field rules ─────────────────
const createSchema = z.object({
  id: z.string().optional(),
  unitId: z.string().min(1, 'Unit is required'),
  customerId: z.string().min(1, 'Customer is required'),
  partId: z.string().min(1, 'Part is required'),
  sourceInwardId: z.string().min(1, 'Source challan is required'),
  rejDcNo: z.string().trim().min(1, 'Rejection DC no. is required'),
  rejDate: z.string().min(1, 'Rejection date is required'),
  mrQty: z.number().int().min(0, 'Quantities cannot be negative'),
  frQty: z.number().int().min(0, 'Quantities cannot be negative'),
  weightBasis: z.enum(['finish', 'scrap']),
  /** Optional override; defaults to the part's finish/scrap weight per the basis. */
  weightPerRingMg: z.number().int().nonnegative().optional(),
})

/** Per-ring weight (mg) from the part's finish/scrap weight per the basis. */
function basisWeightMg(s: RootState, partId: Id, basis: RejectionWeightBasis): number {
  const part = getById(s.masters.parts, partId)
  if (!part) return 0
  return basis === 'scrap' ? part.scrapWtMg : part.finishWtMg
}

/** The unit scope this request may read (null = all units). */
function allowedSet(allowed: Id[] | null): Set<Id> | null {
  return allowed ? new Set(allowed) : null
}

export const rejectionRouter = Router()
rejectionRouter.use(authenticate)

/**
 * GET / — list rejection advices, unit-scoped to the caller's allowed units.
 * Optional `?from=&to=` filters on `rejDate` (inclusive); empty window passes
 * everything.
 */
rejectionRouter.get(
  '/',
  requirePermission('rejection', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query)

    const allowed = allowedSet(req.auth!.allowedUnitIds)
    let rows = values(getDb().rejection.rejectionAdvices)
    if (allowed) rows = rows.filter((a) => allowed.has(a.unitId))
    if (from || to) {
      rows = rows.filter((a) => {
        if (from && a.rejDate < from) return false
        if (to && a.rejDate > to) return false
        return true
      })
    }
    const searchText = (r: (typeof rows)[number]) => r.rejDcNo
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/** GET /:id — one rejection advice, 404 if outside scope or missing. */
rejectionRouter.get(
  '/:id',
  requirePermission('rejection', 'view'),
  asyncHandler(async (req, res) => {
    const advice = getById(getDb().rejection.rejectionAdvices, req.params.id)
    if (!advice) throw notFound('Rejection advice not found')
    assertUnit(req, advice.unitId)
    res.json({ data: advice })
  })
)

/**
 * POST / — create a rejection advice. Ports validateRejection (field rules via
 * the schema; the referential, duplicate-DC, and over-return guards below) +
 * applyRejection (per-ring weight resolution, totalWeightGrams derivation, and
 * server-managed id/createdBy/createdAt). Write scope via assertUnit.
 */
rejectionRouter.post(
  '/',
  requirePermission('rejection', 'create'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body)
    assertUnit(req, body.unitId)

    const db = getDb()
    // Referential checks the frontend gets for free via the masters/inventory stores.
    if (!getById(db.masters.units, body.unitId)) throw badRequest('Unknown unit')
    if (!getById(db.masters.customers, body.customerId)) throw badRequest('Customer is required')
    if (!getById(db.masters.parts, body.partId)) throw badRequest('Part is required')
    const inward = getById(db.inventory.inwards, body.sourceInwardId)
    if (!inward) throw badRequest('Source challan is required')

    if (!(body.mrQty + body.frQty > 0)) throw badRequest('Enter a rejected quantity (MR or FR)')

    // A rejection DC no. is a printed legal document — unique per unit.
    const dupDc = values(db.rejection.rejectionAdvices).some(
      (a) => a.unitId === body.unitId && a.rejDcNo === body.rejDcNo.trim()
    )
    if (dupDc) throw conflict(`Rejection DC ${body.rejDcNo} already exists`)

    // Can't return more rings than the source challan received (sum across its advices).
    const others = values(db.rejection.rejectionAdvices)
      .filter((a) => a.sourceInwardId === body.sourceInwardId)
      .reduce((sum, a) => sum + a.mrQty + a.frQty, 0)
    if (body.mrQty + body.frQty + others > inward.receivedQty) {
      throw badRequest(`Rejected qty exceeds the challan's received qty (${inward.receivedQty})`)
    }

    const perRing = body.weightPerRingMg ?? basisWeightMg(db, body.partId, body.weightBasis)
    const totalRej = body.mrQty + body.frQty
    const totalWeightGrams = Math.round((totalRej * perRing) / 1000)

    const advice: RejectionAdvice = {
      id: resolveId(body.id, (id) => !!getById(db.rejection.rejectionAdvices, id), 'rej'),
      unitId: body.unitId,
      customerId: body.customerId,
      partId: body.partId,
      sourceInwardId: body.sourceInwardId,
      rejDcNo: body.rejDcNo.trim(),
      rejDate: body.rejDate,
      mrQty: body.mrQty,
      frQty: body.frQty,
      weightBasis: body.weightBasis,
      weightPerRingMg: perRing,
      totalWeightGrams,
      createdBy: req.auth!.user.id,
      createdAt: nowISO(),
    }
    await mutate((s) => putEntity(s.rejection.rejectionAdvices, advice))

    res.status(201).json({
      data: advice,
      cascade: [
        `Rejection DC ${advice.rejDcNo}: ${totalRej.toLocaleString('en-IN')} pcs`,
        `${(totalWeightGrams / 1000).toLocaleString('en-IN')} kg (${advice.weightBasis} weight)`,
      ],
    })
  })
)

/**
 * PUT /:id — edit a rejection advice. Same field rules + referential / duplicate-DC
 * / over-return guards as create (the dup-DC and over-return checks exclude the row
 * being edited), with totalWeightGrams recomputed exactly as the create path does.
 * id / createdBy / createdAt are preserved.
 */
rejectionRouter.put(
  '/:id',
  requirePermission('rejection', 'edit'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const existing = getById(db.rejection.rejectionAdvices, req.params.id)
    if (!existing) throw notFound('Rejection advice not found')
    assertUnit(req, existing.unitId)

    const body = createSchema.parse(req.body)
    assertUnit(req, body.unitId)

    // Referential checks the frontend gets for free via the masters/inventory stores.
    if (!getById(db.masters.units, body.unitId)) throw badRequest('Unknown unit')
    if (!getById(db.masters.customers, body.customerId)) throw badRequest('Customer is required')
    if (!getById(db.masters.parts, body.partId)) throw badRequest('Part is required')
    const inward = getById(db.inventory.inwards, body.sourceInwardId)
    if (!inward) throw badRequest('Source challan is required')

    if (!(body.mrQty + body.frQty > 0)) throw badRequest('Enter a rejected quantity (MR or FR)')

    // A rejection DC no. is a printed legal document — unique per unit (excluding self).
    const dupDc = values(db.rejection.rejectionAdvices).some(
      (a) => a.id !== existing.id && a.unitId === body.unitId && a.rejDcNo === body.rejDcNo.trim()
    )
    if (dupDc) throw conflict(`Rejection DC ${body.rejDcNo} already exists`)

    // Can't return more rings than the source challan received (excluding this row).
    const others = values(db.rejection.rejectionAdvices)
      .filter((a) => a.id !== existing.id && a.sourceInwardId === body.sourceInwardId)
      .reduce((sum, a) => sum + a.mrQty + a.frQty, 0)
    if (body.mrQty + body.frQty + others > inward.receivedQty) {
      throw badRequest(`Rejected qty exceeds the challan's received qty (${inward.receivedQty})`)
    }

    const perRing = body.weightPerRingMg ?? basisWeightMg(db, body.partId, body.weightBasis)
    const totalRej = body.mrQty + body.frQty
    const totalWeightGrams = Math.round((totalRej * perRing) / 1000)

    const advice: RejectionAdvice = {
      ...existing,
      unitId: body.unitId,
      customerId: body.customerId,
      partId: body.partId,
      sourceInwardId: body.sourceInwardId,
      rejDcNo: body.rejDcNo.trim(),
      rejDate: body.rejDate,
      mrQty: body.mrQty,
      frQty: body.frQty,
      weightBasis: body.weightBasis,
      weightPerRingMg: perRing,
      totalWeightGrams,
      id: existing.id,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
    }
    await mutate((s) => putEntity(s.rejection.rejectionAdvices, advice))

    res.json({
      data: advice,
      cascade: [
        `Rejection DC ${advice.rejDcNo}: ${totalRej.toLocaleString('en-IN')} pcs`,
        `${(totalWeightGrams / 1000).toLocaleString('en-IN')} kg (${advice.weightBasis} weight)`,
      ],
    })
  })
)

/** DELETE /:id — remove a rejection advice (scope-checked). Ports rejDeleteCmd. */
rejectionRouter.delete(
  '/:id',
  requirePermission('rejection', 'delete'),
  asyncHandler(async (req, res) => {
    const advice = getById(getDb().rejection.rejectionAdvices, req.params.id)
    if (!advice) throw notFound('Rejection advice not found')
    assertUnit(req, advice.unitId)

    await mutate((s) => removeEntity(s.rejection.rejectionAdvices, req.params.id))

    res.json({
      data: { id: req.params.id },
      cascade: [`Rejection DC ${advice.rejDcNo} deleted`],
    })
  })
)
