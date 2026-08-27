/**
 * Reports module (phase 2). Read-only derived roll-ups for the dashboard and the
 * reports screen. Ported from frontend_2.0 src/selectors/{reports,kpi,finance}.ts
 * via the already-ported backend domain selectors. Everything here is DERIVED —
 * nothing is stored. Unit scope comes from req.auth.allowedUnitIds (null = all
 * units) and is threaded into every selector that supports it.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb } from '../../db/repository.js'
import { asyncHandler, badRequest } from '../../lib/http.js'
import { authenticate, requirePermission } from '../../auth/middleware.js'
import type { Id } from '../../types/domain.js'
import { selectDashboardKpis } from '../../domain/kpi.js'
import { selectBillingTotals } from '../../domain/billing.js'
import { selectStockRows } from '../../domain/register.js'
import { reportByKey, type DateRange } from '../../domain/reports.js'

export const reportsRouter = Router()
reportsRouter.use(authenticate)

/** Route-layer scope as a Set (or null = all units) for the ported selectors. */
function allowedSet(req: Request): Set<Id> | null {
  const allowed = req.auth?.allowedUnitIds
  return allowed == null ? null : new Set(allowed)
}

// Optional inclusive date window; ISO date strings (yyyy-mm-dd).
const rangeSchema = z.object({
  from: z.string().min(1).optional(),
  to: z.string().min(1).optional(),
})

function parseRange(req: Request): DateRange {
  const { from, to } = rangeSchema.parse(req.query)
  if (from && to && from > to) throw badRequest('`from` must be on or before `to`')
  return { from, to }
}

// GET /dashboard/kpis — the dashboard KPI bundle (kpi.ts), scoped to the caller.
// Guarded by dashboard:view (the dashboard is the consumer), not reports:view.
reportsRouter.get(
  '/dashboard/kpis',
  requirePermission('dashboard', 'view'),
  asyncHandler(async (req, res) => {
    const data = selectDashboardKpis(getDb(), allowedSet(req))
    res.json({ data })
  })
)

// GET /receivables — aggregate billing receivables across the units in scope
// (finance roll-up from billing.ts).
reportsRouter.get(
  '/receivables',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const data = selectBillingTotals(getDb(), allowedSet(req))
    res.json({ data })
  })
)

// GET /production-summary — per-(unit, part) production movement (received,
// outward, disposed/scrap, available) plus a scoped totals roll-up. Optional
// ?from=&to= restricts the movement columns to that inclusive period.
reportsRouter.get(
  '/production-summary',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = parseRange(req)
    const rows = selectStockRows(getDb(), from, to, allowedSet(req))
    let received = 0
    let outward = 0
    let disposed = 0
    for (const r of rows) {
      received += r.received
      outward += r.outward
      disposed += r.disposed
    }
    res.json({
      data: {
        rows: rows.map((r) => ({
          unitId: r.unitId,
          partId: r.partId,
          partNo: r.partNo,
          received: r.received,
          outward: r.outward,
          disposed: r.disposed,
          available: r.available,
        })),
        totals: { parts: rows.length, received, outward, disposed },
      },
    })
  })
)

// GET /stock-summary — the reports-registry "stock" table (per unit & part) plus
// a scoped available/received/consumed roll-up. Aggregate report, ignores dates.
reportsRouter.get(
  '/stock-summary',
  requirePermission('reports', 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const allowed = allowedSet(req)
    const report = reportByKey('stock')!.build(s, {}, allowed)
    const stockRows = selectStockRows(s, undefined, undefined, allowed)
    let received = 0
    let consumed = 0
    let available = 0
    let unbalanced = 0
    for (const r of stockRows) {
      received += r.received
      consumed += r.consumed
      // Clamp per part: an over-dispatched part can't subtract from the aggregate
      // on-hand total (it's flagged via `unbalanced`/the per-row Reconciled column).
      // Matches the stock-summary KPI's Math.max(0, …).
      available += Math.max(0, r.available)
      if (!r.balanced) unbalanced++
    }
    res.json({
      data: {
        columns: report.columns,
        rows: report.rows,
        totals: { parts: stockRows.length, received, consumed, available, unbalanced },
      },
    })
  })
)
