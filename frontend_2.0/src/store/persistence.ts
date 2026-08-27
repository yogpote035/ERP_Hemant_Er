/**
 * JSON backup export/import for the in-memory API cache. Browser persistence and
 * frontend demo seeding are intentionally disabled; PostgreSQL is the data store.
 */
import { useStore, seedRolesCollection } from './index'
import { pickPersisted, SCHEMA_VERSION, type PersistedState } from './state'
import { SEED_VERSION } from '@/lib/seed'

export interface BackupEnvelope {
  app: 'HEW-ERP'
  schemaVersion: number
  exportedAt: string
  data: PersistedState
}

const REQUIRED_SLICES = [
  'masters', 'inventory', 'billing', 'payments', 'scrap', 'expenses', 'rejection', 'hr', 'system',
] as const

export function buildBackup(): BackupEnvelope {
  return {
    app: 'HEW-ERP',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    data: pickPersisted(useStore.getState()),
  }
}

/** Structural validation of a backup envelope. Throws with a clear message. */
export function validateBackup(json: unknown): BackupEnvelope {
  if (!json || typeof json !== 'object') throw new Error('Backup is not a JSON object')
  const env = json as Partial<BackupEnvelope>
  if (env.app !== 'HEW-ERP') throw new Error('Not a HEW-ERP backup file')
  if (typeof env.schemaVersion !== 'number') throw new Error('Backup is missing schemaVersion')
  if (!env.data || typeof env.data !== 'object') throw new Error('Backup is missing its data')
  for (const k of REQUIRED_SLICES) {
    if (!(k in (env.data as Record<string, unknown>))) throw new Error(`Backup is missing the "${k}" slice`)
  }
  return env as BackupEnvelope
}

/** v1 baseline — future schema bumps chain their migrations here. */
function migrate(data: PersistedState, _fromVersion: number): PersistedState {
  return data
}

export function importBackup(json: unknown): void {
  const env = validateBackup(json)
  const data = migrate(env.data, env.schemaVersion)
  useStore.setState((cur) => {
    // Wholesale state swap: DROP the undo/redo stacks. Their inverse patches are
    // path-addressed against the pre-import tree, so a post-restore Undo would apply
    // them to the imported tree and corrupt entities.
    const next = { ...cur, ...data, _undo: [], _redo: [] }
    // Mark the restored book as already-seeded so the persist merge() can't re-inject
    // demo expenses/rejections/rates into a legitimately-empty restored register.
    next.system = { ...next.system, seedVersion: SEED_VERSION, seeded: true }
    // Backfill the role registry for backups that predate the roles slice, so
    // can() always has a matrix to resolve (mirrors the persist merge()).
    if (!next.masters.roles || next.masters.roles.allIds.length === 0) {
      next.masters = { ...next.masters, roles: seedRolesCollection() }
    }
    return next
  }, true)
}

/** Trigger a browser download of the full backup JSON. */
export function downloadBackup(): void {
  const blob = new Blob([JSON.stringify(buildBackup(), null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `hew-erp-backup-${new Date().toISOString().slice(0, 10)}.json`
  a.click()
  URL.revokeObjectURL(url)
}
