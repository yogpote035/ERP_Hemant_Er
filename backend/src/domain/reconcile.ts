/**
 * Reconciliation — the trust feature, and our own bug-detector (plan §2.12).
 *
 * The naive identity `opening + received = consumed + closing` is algebraically
 * always true (closing is derived from the same numbers) and catches NOTHING.
 * So we assert the genuinely falsifiable invariants instead:
 *   I1  per inward: Σ children.totalQty ≤ received          (no over-dispatch vs a challan)
 *   I2  per (unit,part): derived available ≥ 0              (no oversold stock)
 *   I3  referential: every dispatch.inwardId resolves       (no orphan dispatch)
 *   I5  if a physical StockSnapshot exists: derived available === counted
 *   I6  per inward: Σ rejection-advice qty ≤ received        (can't return more than received)
 *
 * The Reconcile badge goes RED when any of these fail.
 *
 * Scope is passed explicitly (`allowed`): `null` = full cross-unit view
 * (admin + tests); a `Set<Id>` restricts to those units (the route layer
 * supplies `req.auth.allowedUnitIds`).
 */
import type { Id } from '../types/domain.js'
import { values } from '../db/normalized.js'
import type { RootState } from '../db/state.js'
import {
  dispatchTotalQty,
  inwardsOfPart,
  openingOfPart,
  selectAvailableForInward,
} from './stock.js'

export interface ReconcileIssue {
  code: 'overDispatch' | 'oversold' | 'orphanDispatch' | 'snapshotMismatch' | 'overRejection'
  message: string
  unitId?: Id
  partId?: Id
  inwardId?: Id
  dispatchId?: Id
}

export interface PartLedger {
  unitId: Id
  partId: Id
  opening: number
  received: number
  consumed: number
  closing: number
  balanced: boolean
  issues: ReconcileIssue[]
}

export interface ReconcileResult {
  ok: boolean
  redCount: number
  ledgers: PartLedger[]
  orphanDispatchIds: Id[]
}

/** Distinct (unit, part) keys that have any opening / inward / dispatch activity. */
function activePartKeys(s: RootState): { unitId: Id; partId: Id }[] {
  const seen = new Set<string>()
  const out: { unitId: Id; partId: Id }[] = []
  const add = (unitId: Id, partId: Id) => {
    const k = `${unitId}::${partId}`
    if (!seen.has(k)) {
      seen.add(k)
      out.push({ unitId, partId })
    }
  }
  for (const p of values(s.masters.parts)) add(p.unitId, p.id)
  for (const i of values(s.inventory.inwards)) add(i.unitId, i.partId)
  for (const o of values(s.masters.stockOpenings)) add(o.unitId, o.partId)
  return out
}

/** Ledger + invariant checks for a single (unit, part). */
export function selectPartLedger(s: RootState, unitId: Id, partId: Id): PartLedger {
  const inwards = inwardsOfPart(s, unitId, partId)
  const inwardIds = new Set(inwards.map((i) => i.id))
  const disp = values(s.inventory.dispatches).filter((d) => inwardIds.has(d.inwardId))

  const opening = openingOfPart(s, unitId, partId)
  const received = inwards.reduce((a, i) => a + i.receivedQty, 0)
  const consumed = disp.reduce((a, d) => a + dispatchTotalQty(d), 0)
  const closing = opening + received - consumed

  const issues: ReconcileIssue[] = []

  // I1 — per-inward over-dispatch
  for (const inw of inwards) {
    const used = disp
      .filter((d) => d.inwardId === inw.id)
      .reduce((a, d) => a + dispatchTotalQty(d), 0)
    if (used > inw.receivedQty) {
      issues.push({
        code: 'overDispatch',
        message: `Challan ${inw.challanNo}: dispatched ${used} > received ${inw.receivedQty}`,
        unitId,
        partId,
        inwardId: inw.id,
      })
    }
  }

  // I6 — per-inward over-rejection (rejection advices return material against a challan;
  // you can't return more rings than were received). The command layer caps this, but
  // seeded/imported/legacy data bypasses commands, so the gate must assert it too.
  const rejByInward = new Map<Id, number>()
  for (const r of values(s.rejection.rejectionAdvices)) {
    if (inwardIds.has(r.sourceInwardId)) {
      rejByInward.set(r.sourceInwardId, (rejByInward.get(r.sourceInwardId) ?? 0) + r.mrQty + r.frQty)
    }
  }
  for (const inw of inwards) {
    const returned = rejByInward.get(inw.id) ?? 0
    if (returned > inw.receivedQty) {
      issues.push({
        code: 'overRejection',
        message: `Challan ${inw.challanNo}: rejection-advice qty ${returned} > received ${inw.receivedQty}`,
        unitId,
        partId,
        inwardId: inw.id,
      })
    }
  }

  // I2 — oversold
  if (closing < 0) {
    issues.push({ code: 'oversold', message: `Closing stock ${closing} < 0`, unitId, partId })
  }

  // I5 — physical count mismatch (latest snapshot wins)
  const snaps = values(s.system.stockSnapshots)
    .filter((sn) => sn.unitId === unitId && sn.partId === partId)
    .sort((a, b) => a.asOfDate.localeCompare(b.asOfDate))
  const latest = snaps.at(-1)
  if (latest && latest.countedQty !== closing) {
    issues.push({
      code: 'snapshotMismatch',
      message: `Physical count ${latest.countedQty} ≠ derived closing ${closing} (as of ${latest.asOfDate})`,
      unitId,
      partId,
    })
  }

  return { unitId, partId, opening, received, consumed, closing, balanced: issues.length === 0, issues }
}

/**
 * Reconcile over a chosen set of units. `allowed === null` is the full,
 * cross-unit view (admin + tests). When scoped to a unit set, orphan
 * dispatches are NOT surfaced: an orphan's parent inward (hence unit) is
 * unresolvable, so attributing it to a scoped user could leak another unit's
 * problem — those only show in the full view.
 */
export function selectReconcileFor(s: RootState, allowed: Set<Id> | null = null): ReconcileResult {
  const keys = allowed
    ? activePartKeys(s).filter((k) => allowed.has(k.unitId))
    : activePartKeys(s)
  const ledgers = keys.map(({ unitId, partId }) => selectPartLedger(s, unitId, partId))

  // I3 — orphan dispatches (inwardId doesn't resolve); full view only.
  const orphanDispatchIds = allowed
    ? []
    : values(s.inventory.dispatches)
        .filter((d) => !s.inventory.inwards.byId[d.inwardId])
        .map((d) => d.id)

  const redCount = ledgers.filter((l) => !l.balanced).length + orphanDispatchIds.length
  return { ok: redCount === 0, redCount, ledgers, orphanDispatchIds }
}

/** Whole-store reconciliation (full/admin view + tests). */
export function selectReconcile(s: RootState): ReconcileResult {
  return selectReconcileFor(s, null)
}

export { selectAvailableForInward }
