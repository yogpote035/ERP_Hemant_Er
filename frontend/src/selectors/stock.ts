/**
 * Stock selectors (plan §5). Stock is tracked per `(unit, part)`. Everything
 * here is DERIVED — nothing is stored. `currentStock = opening + Σ received −
 * Σ (ok + mcRej + mf)`.
 */
import type { Dispatch, Id, Inward } from '@/types/domain'
import { values } from '@/store/normalized'
import type { RootState } from '@/store/state'

/** Total quantity a dispatch consumes from stock (ok + both rejection buckets). */
export const dispatchTotalQty = (d: Dispatch): number => d.okQty + d.mcRejQty + d.mfQty

/** Inwards for a given (unit, part). */
export function inwardsOfPart(s: RootState, unitId: Id, partId: Id): Inward[] {
  return values(s.inventory.inwards).filter((i) => i.unitId === unitId && i.partId === partId)
}

/** All dispatch children under a set of inward ids. */
export function dispatchesUnder(s: RootState, inwardIds: Set<Id>): Dispatch[] {
  return values(s.inventory.dispatches).filter((d) => inwardIds.has(d.inwardId))
}

/** Sum of opening-stock rows for a (unit, part). */
export function openingOfPart(s: RootState, unitId: Id, partId: Id): number {
  return values(s.masters.stockOpenings)
    .filter((o) => o.unitId === unitId && o.partId === partId)
    .reduce((a, o) => a + o.openingQty, 0)
}

export interface PartStock {
  unitId: Id
  partId: Id
  opening: number
  received: number
  consumed: number
  ok: number
  mcRej: number
  mf: number
  available: number
}

/** Live stock for a (unit, part). */
export function selectPartStock(s: RootState, unitId: Id, partId: Id): PartStock {
  const inwards = inwardsOfPart(s, unitId, partId)
  const inwardIds = new Set(inwards.map((i) => i.id))
  const disp = dispatchesUnder(s, inwardIds)
  const received = inwards.reduce((a, i) => a + i.receivedQty, 0)
  const ok = disp.reduce((a, d) => a + d.okQty, 0)
  const mcRej = disp.reduce((a, d) => a + d.mcRejQty, 0)
  const mf = disp.reduce((a, d) => a + d.mfQty, 0)
  const consumed = ok + mcRej + mf
  const opening = openingOfPart(s, unitId, partId)
  return { unitId, partId, opening, received, consumed, ok, mcRej, mf, available: opening + received - consumed }
}

/** Quantity still available against a specific inward challan. */
export function selectAvailableForInward(s: RootState, inwardId: Id): number {
  const inw = s.inventory.inwards.byId[inwardId]
  if (!inw) return 0
  const consumed = values(s.inventory.dispatches)
    .filter((d) => d.inwardId === inwardId)
    .reduce((a, d) => a + dispatchTotalQty(d), 0)
  return inw.receivedQty - consumed
}

export type InwardBalance = 'In-house' | 'Partial' | 'Dispatched'

/** Open-balance status for an inward challan. */
export function selectInwardBalance(s: RootState, inwardId: Id): InwardBalance {
  const inw = s.inventory.inwards.byId[inwardId]
  if (!inw) return 'Dispatched'
  const available = selectAvailableForInward(s, inwardId)
  if (available >= inw.receivedQty) return 'In-house'
  if (available <= 0) return 'Dispatched'
  return 'Partial'
}
