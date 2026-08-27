/**
 * Unit-scoping choke point (plan §2.6). EVERY list selector composes through
 * here so a query physically cannot leak another unit's rows:
 *  - admin + 'ALL'      → all units
 *  - admin + a unit     → that unit only
 *  - non-admin          → their assignedUnitIds (the switcher cannot widen this)
 *
 * Dispatch has no own unitId — it is scoped via its parent inward.
 */
import type { Dispatch, Id, Inward } from '@/types/domain'
import { currentUser } from './index'
import type { RootState } from './state'
import { values } from './normalized'

/**
 * Units the current user may WRITE to — role-based, IGNORING the view-focus
 * narrowing (`currentUnitId`). A unit switcher only narrows what you SEE; it
 * must not shrink what you may edit. The command-bus uses this to reject a
 * write whose target unit is outside the user's reach (admin → all units).
 */
export function writableUnitIds(s: RootState): Set<Id> {
  const user = currentUser(s)
  if (!user || !user.active) return new Set()
  if (user.role === 'admin') return new Set(s.masters.units.allIds)
  return new Set(user.assignedUnitIds)
}

/** The set of unit ids the current session is allowed to read. */
export function allowedUnitIds(s: RootState): Set<Id> {
  const user = currentUser(s)
  if (!user) return new Set()
  if (user.role === 'admin') {
    return s.session.currentUnitId && s.session.currentUnitId !== 'ALL'
      ? new Set([s.session.currentUnitId])
      : new Set(s.masters.units.allIds)
  }
  const assigned = new Set(user.assignedUnitIds)
  const cur = s.session.currentUnitId
  return cur && cur !== 'ALL' && assigned.has(cur) ? new Set([cur]) : assigned
}

/** Filter any unit-bearing collection to the allowed units. */
export function scopedByUnit<T extends { unitId: Id }>(rows: T[], allowed: Set<Id>): T[] {
  return rows.filter((r) => allowed.has(r.unitId))
}

/** Inwards visible to the current session. */
export function scopedInwards(s: RootState): Inward[] {
  return scopedByUnit(values(s.inventory.inwards), allowedUnitIds(s))
}

/** Dispatches visible to the current session — scoped via the PARENT inward. */
export function scopedDispatches(s: RootState): Dispatch[] {
  const allowed = allowedUnitIds(s)
  return values(s.inventory.dispatches).filter((d) => {
    const inward = s.inventory.inwards.byId[d.inwardId]
    return inward !== undefined && allowed.has(inward.unitId)
  })
}
