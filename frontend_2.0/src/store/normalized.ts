import type { Id, Normalized } from '@/types/domain'

/** A fresh empty normalized collection. */
export function emptyCollection<T>(): Normalized<T> {
  return { byId: {}, allIds: [] }
}

/** Insert or replace an entity, keeping byId and allIds consistent. */
export function putEntity<T extends { id: Id }>(coll: Normalized<T>, e: T): void {
  if (!(e.id in coll.byId)) coll.allIds.push(e.id)
  coll.byId[e.id] = e
}

/** Remove an entity by id (no-op if absent). */
export function removeEntity<T>(coll: Normalized<T>, id: Id): void {
  if (id in coll.byId) {
    delete coll.byId[id]
    const i = coll.allIds.indexOf(id)
    if (i >= 0) coll.allIds.splice(i, 1)
  }
}

/** Shallow-merge a partial into an existing entity (no-op if absent). */
export function patchEntity<T extends { id: Id }>(coll: Normalized<T>, id: Id, patch: Partial<T>): void {
  const cur = coll.byId[id]
  if (cur) coll.byId[id] = { ...cur, ...patch }
}

/** Materialize a collection to an array in insertion order. */
export function values<T>(coll: Normalized<T>): T[] {
  const out: T[] = []
  for (const id of coll.allIds) {
    const e = coll.byId[id]
    if (e !== undefined) out.push(e)
  }
  return out
}

/** Safe single lookup. */
export function getById<T>(coll: Normalized<T>, id: Id | undefined | null): T | undefined {
  return id == null ? undefined : coll.byId[id]
}
