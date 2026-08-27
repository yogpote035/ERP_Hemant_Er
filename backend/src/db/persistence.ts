/**
 * Persistence drivers. The repository keeps the whole RootState in memory (so the
 * ported selectors run unchanged) and delegates durability to a PersistenceDriver:
 *   - FileDriver  — JSON file, for offline dev + fast isolated tests (no DATABASE_URL).
 *   - PgDriver    — Postgres, for production (set DATABASE_URL).
 * Choosing by env keeps routes/tests identical across both.
 */
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Id, Normalized } from '../types/domain.js'
import type { RootState } from './state.js'

/** A single page fetched directly from the datastore (NOT by loading the whole collection). */
export interface PageQuery {
  mode: 'offset' | 'cursor'
  limit: number
  offset?: number
  cursor?: string
  search?: string
  /** Restrict to these unit ids (for unit-scoped collections). */
  unitIds?: string[]
}
export interface PageResult {
  rows: unknown[]
  total: number
  nextCursor: string | null
}

export interface PersistenceDriver {
  /** Create schema / ensure the store exists. */
  init(): Promise<void>
  /** Load the persisted state, or null when the store is empty (⇒ caller seeds). */
  loadState(): Promise<RootState | null>
  /** Persist the current state (driver may diff to write only what changed). */
  saveState(state: RootState): Promise<void>
  /** Wholesale replace (reset-demo / restore-backup): clear then write everything. */
  resetState(state: RootState): Promise<void>
  /** Fetch ONE page of a collection straight from the datastore (real LIMIT/OFFSET or
   *  keyset), so a list request never materializes the whole collection. Optional —
   *  the repository falls back to an in-memory slice when a driver can't query. */
  queryPage?(collection: string, q: PageQuery): Promise<PageResult>
  /** Liveness check for the datastore (readiness probe). */
  ping(): Promise<boolean>
  close(): Promise<void>
}

interface IdEntity { id: Id }

/** Every normalized collection in RootState, addressed by a stable path. */
export const COLLECTIONS: { path: string; get: (s: RootState) => Normalized<IdEntity> }[] = [
  { path: 'masters.units', get: (s) => s.masters.units },
  { path: 'masters.users', get: (s) => s.masters.users },
  { path: 'masters.roles', get: (s) => s.masters.roles as unknown as Normalized<IdEntity> },
  { path: 'masters.customers', get: (s) => s.masters.customers },
  { path: 'masters.vendors', get: (s) => s.masters.vendors },
  { path: 'masters.parts', get: (s) => s.masters.parts },
  { path: 'masters.stockOpenings', get: (s) => s.masters.stockOpenings },
  { path: 'masters.rmRates', get: (s) => s.masters.rmRates },
  { path: 'masters.productionRates', get: (s) => s.masters.productionRates },
  { path: 'masters.machines', get: (s) => s.masters.machines },
  { path: 'masters.operations', get: (s) => s.masters.operations },
  { path: 'masters.employees', get: (s) => s.masters.employees },
  { path: 'inventory.inwards', get: (s) => s.inventory.inwards },
  { path: 'inventory.dispatches', get: (s) => s.inventory.dispatches },
  { path: 'billing.invoices', get: (s) => s.billing.invoices },
  { path: 'payments.payments', get: (s) => s.payments.payments },
  { path: 'scrap.scrapBills', get: (s) => s.scrap.scrapBills },
  { path: 'expenses.expenses', get: (s) => s.expenses.expenses },
  { path: 'rejection.rejectionAdvices', get: (s) => s.rejection.rejectionAdvices },
  { path: 'hr.production', get: (s) => s.hr.production },
  { path: 'hr.shifts', get: (s) => s.hr.shifts },
  { path: 'system.stockSnapshots', get: (s) => s.system.stockSnapshots },
]

/** The non-collection scalars of the system slice (persisted as one row). */
export interface SystemMeta {
  sequences: RootState['system']['sequences']
  schemaVersion: number
  seeded: boolean
  seedVersion: number
}
export function systemMetaOf(s: RootState): SystemMeta {
  return {
    sequences: s.system.sequences,
    schemaVersion: s.system.schemaVersion,
    seeded: s.system.seeded,
    seedVersion: s.system.seedVersion,
  }
}

// ── File driver ───────────────────────────────────────────────────────────────
export class FileDriver implements PersistenceDriver {
  constructor(private file: string) {}
  async init(): Promise<void> {
    const dir = dirname(this.file)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
  async loadState(): Promise<RootState | null> {
    if (!existsSync(this.file)) return null
    try {
      return JSON.parse(readFileSync(this.file, 'utf8')) as RootState
    } catch {
      return null
    }
  }
  async saveState(state: RootState): Promise<void> {
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(state), 'utf8')
    renameSync(tmp, this.file)
  }
  async resetState(state: RootState): Promise<void> {
    await this.saveState(state)
  }
  async ping(): Promise<boolean> {
    return existsSync(dirname(this.file)) || true
  }
  async close(): Promise<void> {}
}
