/**
 * Dashboard KPIs (plan §5) — a single scoped roll-up the dashboard reads.
 * Everything composes through the unit-scoping choke point so a non-admin (or
 * an admin focused on one unit) sees only their slice. All DERIVED.
 */
import type { Paise } from '@/lib/money'
import { values } from '@/store/normalized'
import type { RootState } from '@/store/state'
import { allowedUnitIds, scopedInwards, scopedDispatches } from '@/store/scope'
import { dispatchTotalQty } from './stock'
import { selectReconcileScoped } from './reconcile'
import { selectBillingTotals } from './billing'

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

export function selectDashboardKpis(s: RootState): DashboardKpis {
  const allowed = allowedUnitIds(s)
  const inwards = scopedInwards(s)
  const dispatches = scopedDispatches(s)

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
    (p) => p.active && allowed.has(p.unitId)
  ).length
  const piecesDispatched = dispatches.reduce((a, d) => a + dispatchTotalQty(d), 0)

  const reconcile = selectReconcileScoped(s)
  const billing = selectBillingTotals(s)

  return {
    unitsInScope: allowed.size,
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
