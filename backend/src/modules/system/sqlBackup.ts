import { Buffer } from 'node:buffer'
import { COLLECTIONS, systemMetaOf } from '../../db/persistence.js'
import { createEmptyState, type RootState } from '../../db/state.js'
import { putEntity } from '../../db/normalized.js'

const hex = (value: string): string => `0x${Buffer.from(value, 'utf8').toString('hex')}`
const unhex = (value: string): string => Buffer.from(value.slice(2), 'hex').toString('utf8')

const safeDatabaseName = (name: string): string => /^[A-Za-z0-9_]+$/.test(name) ? name : 'hemant_erp'

/** Create a standalone MySQL/TiDB dump: database, tables, indexes and all rows. */
export function buildSqlBackup(state: RootState, databaseName = 'hemant_erp'): string {
  const db = safeDatabaseName(databaseName)
  const lines = [
    '-- HEW-ERP SQL BACKUP v2',
    `-- Exported: ${new Date().toISOString()}`,
    '-- Complete logical backup: schema + indexes + data',
    '-- Compatible with MySQL 8 and TiDB Cloud',
    '',
    'SET NAMES utf8mb4;',
    'SET FOREIGN_KEY_CHECKS = 0;',
    `CREATE DATABASE IF NOT EXISTS \`${db}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`,
    `USE \`${db}\`;`,
    '',
    '-- Persistent entity records for all ERP modules',
    'CREATE TABLE IF NOT EXISTS documents (',
    '  collection VARCHAR(100) NOT NULL,',
    '  id VARCHAR(191) NOT NULL,',
    '  data JSON NOT NULL,',
    '  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,',
    '  PRIMARY KEY (collection, id),',
    '  KEY idx_documents_updated_at (updated_at)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
    '',
    '-- Immutable application activity/audit trail',
    'CREATE TABLE IF NOT EXISTS activity_log (',
    '  id VARCHAR(191) NOT NULL,',
    '  ts VARCHAR(64) NOT NULL,',
    '  data JSON NOT NULL,',
    '  PRIMARY KEY (id),',
    '  KEY idx_activity_log_ts (ts)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
    '',
    '-- Sequences and application schema metadata',
    'CREATE TABLE IF NOT EXISTS kv (',
    '  k VARCHAR(191) NOT NULL,',
    '  v JSON NOT NULL,',
    '  PRIMARY KEY (k)',
    ') ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;',
    '',
    'START TRANSACTION;',
    '-- Clear existing rows before restoring this complete snapshot',
    'DELETE FROM documents;',
    'DELETE FROM activity_log;',
    'DELETE FROM kv;',
    '',
  ]
  for (const collection of COLLECTIONS) {
    const rows = collection.get(state)
    lines.push(`-- ${collection.path}: ${rows.allIds.length} record(s)`)
    for (const id of rows.allIds) {
      const entity = rows.byId[id]
      if (!entity) continue
      lines.push(`INSERT INTO documents (collection,id,data) VALUES (${hex(collection.path)},${hex(id)},${hex(JSON.stringify(entity))});`)
    }
    lines.push('')
  }
  lines.push(`-- system.activityLog: ${state.system.activityLog.length} record(s)`)
  for (const entry of state.system.activityLog) {
    lines.push(`INSERT INTO activity_log (id,ts,data) VALUES (${hex(entry.id)},${hex(entry.ts)},${hex(JSON.stringify(entry))});`)
  }
  lines.push('', '-- Application sequences and schema version')
  lines.push(`INSERT INTO kv (k,v) VALUES (${hex('system')},${hex(JSON.stringify(systemMetaOf(state)))});`)
  lines.push('', 'COMMIT;', 'SET FOREIGN_KEY_CHECKS = 1;', '', '-- End of HEW-ERP SQL backup', '')
  return lines.join('\n')
}

/** Parse only SQL generated above; arbitrary uploaded SQL is never executed. */
export function parseSqlBackup(sql: string): RootState {
  if (!/^-- HEW-ERP SQL BACKUP v[12]/.test(sql)) throw new Error('Not a HEW-ERP SQL backup file')
  const state = createEmptyState()
  const byPath = new Map(COLLECTIONS.map((c) => [c.path, c]))
  const docRe = /^INSERT INTO documents \(collection,id,data\) VALUES \((0x[0-9a-f]+),(0x[0-9a-f]+),(0x[0-9a-f]+)\);$/gim
  const activityRe = /^INSERT INTO activity_log \(id,ts,data\) VALUES \((0x[0-9a-f]+),(0x[0-9a-f]+),(0x[0-9a-f]+)\);$/gim
  const metaRe = /^INSERT INTO kv \(k,v\) VALUES \((0x[0-9a-f]+),(0x[0-9a-f]+)\);$/im
  let match: RegExpExecArray | null
  let documentCount = 0
  while ((match = docRe.exec(sql))) {
    const collection = byPath.get(unhex(match[1]))
    if (!collection) continue
    const entity = JSON.parse(unhex(match[3])) as { id: string }
    if (entity.id !== unhex(match[2])) throw new Error('Backup contains a mismatched record id')
    putEntity(collection.get(state), entity)
    documentCount++
  }
  while ((match = activityRe.exec(sql))) {
    state.system.activityLog.push(JSON.parse(unhex(match[3])))
  }
  const meta = metaRe.exec(sql)
  if (!meta || unhex(meta[1]) !== 'system') throw new Error('Backup is missing system metadata')
  const system = JSON.parse(unhex(meta[2])) as ReturnType<typeof systemMetaOf>
  state.system = { ...state.system, ...system }
  if (documentCount === 0) throw new Error('Backup contains no ERP records')
  return state
}
