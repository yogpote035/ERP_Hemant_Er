/**
 * Repository — the single persistence boundary. Keeps the whole RootState in
 * memory (so the ported selectors run unchanged) and delegates durability to a
 * PersistenceDriver chosen by config: MySQL/TiDB (DB_HOST set) or a JSON file.
 * Routes call getDb() (read) and mutate() (write); writes are serialized so the
 * driver never sees interleaved transactions.
 */
import { resolve } from 'node:path'
import { config } from '../config.js'
import { getById, values } from './normalized.js'
import { createEmptyState, type RootState } from './state.js'
import { seedState, bootstrapState } from './seed.js'
import { setRoleResolver } from '../types/rbac.js'
import { FileDriver, COLLECTIONS, type PageQuery, type PageResult, type PersistenceDriver } from './persistence.js'
import { MysqlDriver } from './mysqlDriver.js'
import { genericSearchText } from '../lib/list.js'
import { log } from '../lib/logging.js'

let state: RootState = createEmptyState()
let driver: PersistenceDriver | null = null
let writeChain: Promise<void> = Promise.resolve()
/** After a direct paging query loses the remote DB, serve pages from the already
 * loaded authoritative memory state for a short period instead of making every
 * request wait for the same network timeout. Writes still require the database. */
let pageQueryBackoffUntil = 0
/** Monotonic in-memory state version — drives optimistic-concurrency on the
 *  full-state snapshot endpoint. Bumped on every successful write; resets to 0 on
 *  restart (a stale client then gets one 409 and re-syncs). */
let version = 0

export function getVersion(): number {
  return version
}

function makeDriver(): PersistenceDriver {
  return config.dbHost ? new MysqlDriver({
    host: config.dbHost,
    port: config.dbPort,
    user: config.dbUser,
    password: config.dbPassword,
    database: config.dbName,
    ssl: config.dbSsl,
  }) : new FileDriver(resolve(config.dataFile))
}

/** Resolve roles through the live (possibly edited) role matrices. */
function wireRoleResolver(): void {
  setRoleResolver((roleId) => getById(state.masters.roles, roleId)?.permissions)
}

/** First-run admin creds for a production bootstrap (no demo data) — fail loudly if absent. */
function requireBootstrapAdmin(): { adminEmail: string; adminPassword: string } {
  const adminEmail = config.seedAdminEmail
  const adminPassword = config.seedAdminPassword
  if (!adminEmail || !adminPassword || adminPassword.length < 8) {
    throw new Error(
      'Empty database and demo seed is off: set SEED_ADMIN_EMAIL and a strong ' +
        'SEED_ADMIN_PASSWORD (≥ 8 chars) to create the initial admin account. ' +
        '(Set SEED_DEMO=true to load demo data instead — never in production.)'
    )
  }
  return { adminEmail, adminPassword }
}

/** Open the store, loading existing data or seeding a fresh one. */
export async function initRepository(): Promise<void> {
  driver = makeDriver()
  await driver.init()
  const loaded = await driver.loadState()
  if (loaded) {
    state = loaded
  } else {
    state = config.seedDemo ? seedState() : bootstrapState(requireBootstrapAdmin())
    await driver.resetState(state)
  }
  wireRoleResolver()
}

/** Read-only access to the live state. Do NOT mutate the returned object directly. */
export function getDb(): RootState {
  return state
}

/**
 * Apply a mutation and persist it atomically. Writes are serialized (chained) so
 * the driver commits them in order; the chain stays alive on error while THIS
 * write's failure propagates to the caller (→ 500), surfacing a dead datastore
 * instead of silently diverging.
 */
export async function mutate<T>(fn: (s: RootState) => T): Promise<T> {
  if (!driver) throw new Error('Repository not initialized')
  const result = fn(state)
  const persisted = writeChain.then(() => driver!.saveState(state))
  writeChain = persisted.catch(() => {})
  try {
    await persisted
  } catch (err) {
    // The durable write failed (PG transaction rolled back). The in-memory state is
    // now ahead of the datastore — revert it by reloading, so reads never reflect an
    // unpersisted change. Surfaces as a 500 to the caller.
    log.error('persist failed — reverting in-memory state', { error: (err as Error)?.message })
    await reloadFromDriver().catch(() => {})
    throw err
  }
  version++
  return result
}

/** Reload the whole state from the datastore (used to recover after a failed write). */
async function reloadFromDriver(): Promise<void> {
  if (!driver) return
  const loaded = await driver.loadState()
  if (loaded) {
    state = loaded
    wireRoleResolver()
  }
}

/** Datastore liveness, for the readiness probe. */
export async function ping(): Promise<boolean> {
  return driver ? driver.ping() : false
}

/** Wholesale replace (reset-demo / restore-backup). */
export async function replaceState(next: RootState): Promise<void> {
  if (!driver) throw new Error('Repository not initialized')
  state = next
  wireRoleResolver()
  const persisted = writeChain.then(() => driver!.resetState(state))
  writeChain = persisted.catch(() => {})
  await persisted
  version++
}

/**
 * Fetch ONE page of a collection from the datastore. On Postgres this is a real
 * `LIMIT/OFFSET` (or keyset `id > cursor`) SQL query — the whole collection is never
 * loaded. On the file driver it falls back to an in-memory slice (dev/test only).
 */
export async function queryCollectionPage(path: string, q: PageQuery): Promise<PageResult> {
  if (driver?.queryPage && Date.now() >= pageQueryBackoffUntil) {
    try {
      return await driver.queryPage(path, q)
    } catch (error) {
      pageQueryBackoffUntil = Date.now() + 60_000
      log.warn('direct database page query failed; using memory fallback', {
        collection: path,
        error: (error as Error)?.message,
        retryAfterSeconds: 60,
      })
    }
  }

  // In-memory fallback (file/test or temporary remote database interruption):
  // slice the state loaded from the same durable datastore at startup.
  const cfg = COLLECTIONS.find((c) => c.path === path)
  if (!cfg) return { rows: [], total: 0, nextCursor: null }
  let rows = values(cfg.get(state)) as Array<{ id: string; unitId?: string }>
  if (q.unitIds) rows = rows.filter((r) => r.unitId != null && q.unitIds!.includes(r.unitId))
  if (q.search) {
    const needle = q.search.toLowerCase()
    rows = rows.filter((r) => genericSearchText(r as Record<string, unknown>).toLowerCase().includes(needle))
  }
  const total = rows.length
  const limit = Math.max(1, Math.min(1000, Math.trunc(q.limit) || 25))
  if (q.mode === 'cursor') {
    let start = 0
    if (q.cursor) {
      const i = rows.findIndex((r) => r.id === q.cursor)
      start = i >= 0 ? i + 1 : 0
    }
    const page = rows.slice(start, start + limit)
    const nextCursor = start + limit < total && page.length ? page[page.length - 1].id : null
    return { rows: page, total, nextCursor }
  }
  const offset = Math.max(0, Math.trunc(q.offset ?? 0))
  return { rows: rows.slice(offset, offset + limit), total, nextCursor: null }
}

export async function closeRepository(): Promise<void> {
  await driver?.close()
  driver = null
}

export { getById, values }
