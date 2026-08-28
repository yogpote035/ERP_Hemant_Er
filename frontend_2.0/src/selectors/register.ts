/**
 * Register selectors (plan §5) — the inward→dispatch grid shape and the rate
 * default used by the outward form. All DERIVED + scoped through the choke point.
 */
import type { Dispatch, Id, Inward } from '@/types/domain'
import type { Paise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { values, getById } from '@/store/normalized'
import type { RootState } from '@/store/state'
import { scopedInwards, scopedDispatches, allowedUnitIds } from '@/store/scope'
import {
  dispatchTotalQty,
  selectAvailableForInward,
  selectInwardBalance,
  selectPartStock,
  type InwardBalance,
} from './stock'
import { selectPartLedger } from './reconcile'

export interface DispatchChild {
  dispatch: Dispatch
  total: number
  /** Bill No of the invoice this dispatch is attached to, if any. */
  invoiceBillNo?: string
}

export interface InwardRow {
  inward: Inward
  partNo: string
  vendorName: string
  received: number
  dispatched: number
  available: number
  balance: InwardBalance
  children: DispatchChild[]
}

/** Scoped inward rows, each with its child dispatches + derived balance. */
export function selectInwardRows(s: RootState): InwardRow[] {
  const inwards = scopedInwards(s)
  const dispatches = values(s.inventory.dispatches)
  const invoices = values(s.billing.invoices)
  const billOf = (dispatchId: Id): string | undefined =>
    invoices.find((inv) => inv.dispatchIds.includes(dispatchId))?.billNo

  return inwards
    .map((inward) => {
      const children: DispatchChild[] = dispatches
        .filter((d) => d.inwardId === inward.id)
        .map((d) => ({ dispatch: d, total: dispatchTotalQty(d), invoiceBillNo: billOf(d.id) }))
      const dispatched = children.reduce((a, c) => a + c.total, 0)
      const part = getById(s.masters.parts, inward.partId)
      const vendor = getById(s.masters.vendors, inward.vendorId)
      return {
        inward,
        partNo: part?.partNo ?? '—',
        vendorName: vendor?.name ?? '—',
        received: inward.receivedQty,
        dispatched,
        available: selectAvailableForInward(s, inward.id),
        balance: selectInwardBalance(s, inward.id),
        children,
      }
    })
    .sort((a, b) => b.inward.challanDate.localeCompare(a.inward.challanDate))
}

/** Scoped inward rows that still have available (un-dispatched) balance. */
export function selectOpenInwardRows(s: RootState): InwardRow[] {
  return selectInwardRows(s).filter((r) => r.available > 0)
}

/** Latest production rate for a part that is EFFECTIVE as of today (not future-dated,
 *  not superseded) — used to prefill the outward billing rate. */
export function latestProductionRatePaise(s: RootState, partId: Id, asOf = todayISO()): Paise | undefined {
  const candidates = values(s.masters.productionRates)
    .filter((r) => r.partId === partId && r.effectiveFrom <= asOf && (!r.supersededAt || r.supersededAt > asOf))
    .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))
  return candidates[0]?.ratePaise
}

export interface StockRow {
  unitId: Id
  partId: Id
  partNo: string
  opening: number
  /** Inward (received) qty. */
  received: number
  /** Total removed from stock (outward + disposed). */
  consumed: number
  /** Outward = OK pieces dispatched/billed. */
  outward: number
  /** Disposed / Scrap = machine-reject + RM-fault pieces (removed, not billed). */
  disposed: number
  available: number
  balanced: boolean
}

/** Derived per-(unit, part) stock for the units the session may read. A `from`/`to`
 *  window restricts the movement columns to that period (reconcile stays all-time). */
export function selectStockRows(s: RootState, from?: string, to?: string): StockRow[] {
  const allowed = allowedUnitIds(s)
  const seen = new Set<string>()
  const rows: StockRow[] = []
  const add = (unitId: Id, partId: Id) => {
    if (!allowed.has(unitId)) return
    const key = `${unitId}::${partId}`
    if (seen.has(key)) return
    seen.add(key)
    const st = selectPartStock(s, unitId, partId, from, to)
    const led = selectPartLedger(s, unitId, partId)
    rows.push({
      unitId,
      partId,
      partNo: getById(s.masters.parts, partId)?.partNo ?? '—',
      opening: st.opening,
      received: st.received,
      consumed: st.consumed,
      outward: st.ok,
      disposed: st.mcRej + st.mf,
      available: st.available,
      balanced: led.balanced,
    })
  }
  for (const p of values(s.masters.parts)) add(p.unitId, p.id)
  for (const i of values(s.inventory.inwards)) add(i.unitId, i.partId)
  for (const o of values(s.masters.stockOpenings)) add(o.unitId, o.partId)
  return rows.sort((a, b) => a.partNo.localeCompare(b.partNo))
}

export interface DispatchRow {
  dispatch: Dispatch
  challanNo: string
  partNo: string
  invoiceBillNo?: string
}

/** Flat dispatch log (scoped via the parent inward), newest first. */
export function selectDispatchRows(s: RootState): DispatchRow[] {
  const invoices = values(s.billing.invoices)
  return scopedDispatches(s)
    .map((d) => {
      const inw = getById(s.inventory.inwards, d.inwardId)
      const part = inw ? getById(s.masters.parts, inw.partId) : undefined
      return {
        dispatch: d,
        challanNo: inw?.challanNo ?? '—',
        partNo: part?.partNo ?? '—',
        invoiceBillNo: invoices.find((inv) => inv.dispatchIds.includes(d.id))?.billNo,
      }
    })
    .sort((a, b) => (b.dispatch.dispatchDate ?? '').localeCompare(a.dispatch.dispatchDate ?? ''))
}
