/**
 * Dashboard KPIs (plan §5) — a single scoped roll-up the dashboard reads.
 * All DERIVED.
 *
 * Unit scope is passed explicitly as `allowed?: Set<Id> | null` (null = no
 * scoping = all units; the route layer supplies `req.auth.allowedUnitIds`).
 */
import type { Id } from '../types/domain.js'
import type { Paise } from '../lib/money.js'
import { values } from '../db/normalized.js'
import type { RootState } from '../db/state.js'
import { dispatchTotalQty } from './stock.js'
import { selectReconcileFor } from './reconcile.js'
import { selectBillingTotals } from './billing.js'

export interface DashboardKpis {
  unitsInScope: number
  activeParts: number
  /** Inwards not yet fully dispatched (In-house or Partial). */
  openInwards: number
  inwardsTotal: number
  dispatchesTotal: number
  /** Pieces consumed by dispatches in scope (ok + both rejection buckets). */
  piecesDispatched: number
  invoiced: Paise
  outstanding: Paise
  overdueInvoices: number
  draftInvoices: number
  reconcileOk: boolean
  reconcileRed: number
}

export function selectDashboardKpis(s: RootState, allowed: Set<Id> | null = null): DashboardKpis {
  const allInwards = values(s.inventory.inwards)
  const inwards = allowed ? allInwards.filter((i) => allowed.has(i.unitId)) : allInwards
  const inwardIdInScope = new Set(inwards.map((i) => i.id))
  const dispatches = values(s.inventory.dispatches).filter((d) => inwardIdInScope.has(d.inwardId))

  // Open = challan with stock still in-house (some pieces not yet dispatched).
  const consumedByInward = new Map<string, number>()
  for (const d of dispatches) {
    consumedByInward.set(d.inwardId, (consumedByInward.get(d.inwardId) ?? 0) + dispatchTotalQty(d))
  }
  let openInwards = 0
  for (const i of inwards) {
    if ((consumedByInward.get(i.id) ?? 0) < i.receivedQty) openInwards++
  }

  const activeParts = values(s.masters.parts).filter(
    (p) => p.active && (!allowed || allowed.has(p.unitId))
  ).length
  const piecesDispatched = dispatches.reduce((a, d) => a + dispatchTotalQty(d), 0)

  const reconcile = selectReconcileFor(s, allowed)
  const billing = selectBillingTotals(s, allowed)

  const unitsInScope = allowed
    ? allowed.size
    : values(s.masters.units).length

  return {
    unitsInScope,
    activeParts,
    openInwards,
    inwardsTotal: inwards.length,
    dispatchesTotal: dispatches.length,
    piecesDispatched,
    invoiced: billing.invoiced,
    outstanding: billing.outstanding,
    overdueInvoices: billing.overdueCount,
    draftInvoices: billing.draftCount,
    reconcileOk: reconcile.ok,
    reconcileRed: reconcile.redCount,
  }
}
