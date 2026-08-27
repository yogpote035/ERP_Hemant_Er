import { randomUUID } from 'node:crypto'

/** Generate a prefixed unique id, e.g. `genId('inv') => 'inv-3f2a…'`. */
export function genId(prefix: string): string {
  return `${prefix}-${randomUUID().slice(0, 12)}`
}

/**
 * Resolve the id for a CREATE: honour a client-supplied id (so an optimistic UI's
 * id matches the server's — no divergence, idempotent retries) but only when it's
 * a non-colliding string; otherwise mint a fresh one.
 */
export function resolveId(provided: unknown, exists: (id: string) => boolean, prefix: string): string {
  return typeof provided === 'string' && provided.length > 0 && !exists(provided) ? provided : genId(prefix)
}

/** Current timestamp as ISO string. */
export function nowISO(): string {
  return new Date().toISOString()
}

/** Today's calendar date `yyyy-MM-dd`. */
export function todayISO(): string {
  return new Date().toISOString().slice(0, 10)
}
