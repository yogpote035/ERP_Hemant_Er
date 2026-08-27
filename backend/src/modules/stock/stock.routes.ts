/**
 * Stock module (phase 2). Read-only derived views over per-(unit, part) stock.
 * Ported from frontend_2.0 src/selectors/register.ts (selectStockRows) and
 * src/selectors/stock.ts (selectPartStock). All values are DERIVED — nothing is
 * stored here. Unit scope comes from req.auth.allowedUnitIds (null = all units).
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, values, getById } from '../../db/repository.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import type { Id } from '../../types/domain.js'
import { selectStockRows, latestProductionRatePaise } from '../../domain/register.js'
import { selectPartStock } from '../../domain/stock.js'
import { addP, mulQty, type Paise } from '../../lib/money.js'
import { buildList, cursorList } from '../../lib/list.js'

const LOW_STOCK = 100 // reorder threshold (pcs)

export const stockRouter = Router()
stockRouter.use(authenticate)

/** Route-layer scope as a Set (or null = all units) for the ported selectors. */
function allowedSet(req: Request): Set<Id> | null {
  const allowed = req.auth?.allowedUnitIds
  return allowed == null ? null : new Set(allowed)
}

// Optional inclusive movement window; ISO date strings (yyyy-mm-dd).
const windowSchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
})

// GET / — derived stock rows for every (unit, part) the caller may read.
// Optional ?from=&to= restricts the movement columns to that inclusive period.
stockRouter.get(
  '/',
  requirePermission('stock', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = windowSchema.parse(req.query)
    if (from && to && from > to) throw badRequest('`from` must be on or before `to`')
    const db = getDb()
    const rows = selectStockRows(db, from, to, allowedSet(req))
    // Search the part no. AND the unit code (both are visible columns).
    const searchText = (r: (typeof rows)[number]) => `${r.partNo} ${getById(db.masters.units, r.unitId)?.code ?? ''}`
    // `?mode=cursor` ⇒ keyset pagination (composite unit:part key); else offset/all.
    if (req.query.mode === 'cursor') {
      res.json(cursorList(rows, req.query, { idOf: (r) => `${r.unitId}:${r.partId}`, searchText }))
    } else {
      res.json(buildList(rows, req.query, searchText))
    }
  })
)

// GET /summary — KPI aggregates over the FULL scoped stock (so a paged table can
// still show whole-dataset totals). Same optional ?from=&to= movement window.
stockRouter.get(
  '/summary',
  requirePermission('stock', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = windowSchema.parse(req.query)
    if (from && to && from > to) throw badRequest('`from` must be on or before `to`')
    const allowed = allowedSet(req)
    const s = getDb()
    const rows = selectStockRows(s, from, to, allowed)
    let available = 0
    let disposed = 0
    let lowStock = 0
    let activeParts = 0
    let value = 0 as Paise
    for (const r of rows) {
      available += Math.max(0, r.available)
      disposed += r.disposed
      if (r.available <= LOW_STOCK) lowStock++
      if (r.available > 0) {
        activeParts++
        const rate = latestProductionRatePaise(s, r.partId)
        if (rate != null) value = addP(value, mulQty(rate, r.available))
      }
    }
    const heats = new Set(
      values(s.inventory.inwards)
        .filter((i) => allowed == null || allowed.has(i.unitId))
        .map((i) => i.batchHeatNo)
        .filter(Boolean)
    ).size
    res.json({ data: { available, disposed, lowStock, activeParts, value, skus: rows.length, heats } })
  })
)

// GET /:unitId/:partId — single live stock for one (unit, part).
// Optional ?from=&to= restricts the movement columns to that inclusive period.
stockRouter.get(
  '/:unitId/:partId',
  requirePermission('stock', 'view'),
  asyncHandler(async (req, res) => {
    const { unitId, partId } = req.params
    assertUnit(req, unitId)
    const { from, to } = windowSchema.parse(req.query)
    if (from && to && from > to) throw badRequest('`from` must be on or before `to`')
    const s = getDb()
    const row = selectPartStock(s, unitId, partId, from, to)
    // Nothing known about this (unit, part) at all ⇒ 404 rather than a zero row.
    const known =
      row.opening !== 0 ||
      row.received !== 0 ||
      row.consumed !== 0 ||
      s.masters.parts.byId[partId] != null
    if (!known) throw notFound(`No stock for part '${partId}' in unit '${unitId}'`)
    res.json({ data: row })
  })
)
