import mysql, { type Pool, type RowDataPacket } from 'mysql2/promise'
import { createEmptyState, type RootState } from './state.js'
import { putEntity } from './normalized.js'
import {
  COLLECTIONS,
  systemMetaOf,
  type PageQuery,
  type PageResult,
  type PersistenceDriver,
  type SystemMeta,
} from './persistence.js'
import type { ActivityLogEntry } from '../types/domain.js'

interface MysqlConfig {
  host: string
  port: number
  user: string
  password: string
  database: string
  ssl: boolean
}

interface DocumentRow extends RowDataPacket { collection: string; id: string; data: unknown }
interface ActivityRow extends RowDataPacket { data: unknown }
interface MetaRow extends RowDataPacket { v: unknown }
interface CountRow extends RowDataPacket { n: number }

const SEP = '\0'

function jsonValue<T>(value: unknown): T {
  return (typeof value === 'string' ? JSON.parse(value) : value) as T
}

/** MySQL-compatible persistence driver (also works with TiDB Cloud). */
export class MysqlDriver implements PersistenceDriver {
  private pool: Pool
  private docShadow = new Map<string, string>()
  private actShadow = new Set<string>()
  private metaShadow = ''

  constructor(config: MysqlConfig) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      ssl: config.ssl ? { minVersion: 'TLSv1.2' } : undefined,
      connectionLimit: 8,
      enableKeepAlive: true,
    })
  }

  async init(): Promise<void> {
    await this.pool.execute(`create table if not exists documents (
      collection varchar(100) not null,
      id varchar(191) not null,
      data json not null,
      updated_at timestamp not null default current_timestamp on update current_timestamp,
      primary key (collection, id)
    )`)
    await this.pool.execute(`create table if not exists activity_log (
      id varchar(191) primary key,
      ts varchar(64) not null,
      data json not null
    )`)
    await this.pool.execute(`create table if not exists kv (
      k varchar(191) primary key,
      v json not null
    )`)
  }

  async loadState(): Promise<RootState | null> {
    const [docsResult, actsResult, metaResult] = await Promise.all([
      this.pool.query<DocumentRow[]>('select collection, id, data from documents'),
      this.pool.query<ActivityRow[]>('select data from activity_log order by ts asc'),
      this.pool.query<MetaRow[]>("select v from kv where k = 'system'"),
    ])
    const docs = docsResult[0]
    const acts = actsResult[0]
    const meta = metaResult[0]
    if (docs.length === 0 && meta.length === 0) return null

    const state = createEmptyState()
    const byPath = new Map(COLLECTIONS.map((c) => [c.path, c]))
    for (const row of docs) {
      const collection = byPath.get(row.collection)
      if (!collection) continue
      const data = jsonValue<{ id: string }>(row.data)
      putEntity(collection.get(state), data)
      this.docShadow.set(row.collection + SEP + row.id, JSON.stringify(data))
    }
    state.system.activityLog = acts.map((row) => jsonValue<ActivityLogEntry>(row.data))
    for (const entry of state.system.activityLog) this.actShadow.add(entry.id)
    if (meta[0]) {
      const value = jsonValue<SystemMeta>(meta[0].v)
      state.system.sequences = value.sequences ?? {}
      state.system.schemaVersion = value.schemaVersion ?? state.system.schemaVersion
      state.system.seeded = value.seeded ?? true
      state.system.seedVersion = value.seedVersion ?? state.system.seedVersion
      this.metaShadow = JSON.stringify(value)
    }
    return state
  }

  async saveState(state: RootState): Promise<void> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      for (const collection of COLLECTIONS) {
        const normalized = collection.get(state)
        const seen = new Set<string>()
        for (const id of normalized.allIds) {
          const entity = normalized.byId[id]
          if (!entity) continue
          seen.add(id)
          const json = JSON.stringify(entity)
          const key = collection.path + SEP + id
          if (this.docShadow.get(key) !== json) {
            await connection.execute(
              `insert into documents(collection, id, data) values(?, ?, ?)
               on duplicate key update data = values(data), updated_at = current_timestamp`,
              [collection.path, id, json]
            )
            this.docShadow.set(key, json)
          }
        }
        const prefix = collection.path + SEP
        for (const key of this.docShadow.keys()) {
          if (!key.startsWith(prefix)) continue
          const id = key.slice(prefix.length)
          if (!seen.has(id)) {
            await connection.execute('delete from documents where collection = ? and id = ?', [collection.path, id])
            this.docShadow.delete(key)
          }
        }
      }
      for (const entry of state.system.activityLog) {
        if (this.actShadow.has(entry.id)) continue
        await connection.execute(
          'insert ignore into activity_log(id, ts, data) values(?, ?, ?)',
          [entry.id, entry.ts, JSON.stringify(entry)]
        )
        this.actShadow.add(entry.id)
      }
      const metaJson = JSON.stringify(systemMetaOf(state))
      if (metaJson !== this.metaShadow) {
        await connection.execute(
          "insert into kv(k, v) values('system', ?) on duplicate key update v = values(v)",
          [metaJson]
        )
        this.metaShadow = metaJson
      }
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
  }

  async resetState(state: RootState): Promise<void> {
    const connection = await this.pool.getConnection()
    try {
      await connection.beginTransaction()
      await connection.execute('delete from documents')
      await connection.execute('delete from activity_log')
      await connection.execute('delete from kv')
      await connection.commit()
    } catch (error) {
      await connection.rollback()
      throw error
    } finally {
      connection.release()
    }
    this.docShadow.clear()
    this.actShadow.clear()
    this.metaShadow = ''
    await this.saveState(state)
  }

  async queryPage(collection: string, q: PageQuery): Promise<PageResult> {
    const filters = ['collection = ?']
    const params: unknown[] = [collection]
    if (q.unitIds?.length) {
      filters.push(`json_unquote(json_extract(data, '$.unitId')) in (${q.unitIds.map(() => '?').join(',')})`)
      params.push(...q.unitIds)
    }
    if (q.search) {
      filters.push('lower(cast(data as char)) like ?')
      params.push(`%${q.search.toLowerCase()}%`)
    }
    const whereSql = filters.join(' and ')
    const limit = Math.max(1, Math.min(1000, Math.trunc(q.limit) || 25))
    const [countRows] = await this.pool.query<CountRow[]>(
      `select count(*) as n from documents where ${whereSql}`,
      params
    )
    const total = Number(countRows[0]?.n ?? 0)

    const pageParams = [...params]
    let sql: string
    if (q.mode === 'cursor' && q.cursor) {
      pageParams.push(q.cursor)
      sql = `select data from documents where ${whereSql} and id > ? order by id asc limit ${limit}`
    } else if (q.mode === 'cursor') {
      sql = `select data from documents where ${whereSql} order by id asc limit ${limit}`
    } else {
      const offset = Math.max(0, Math.trunc(q.offset ?? 0))
      sql = `select data from documents where ${whereSql} order by id asc limit ${limit} offset ${offset}`
    }
    const [rows] = await this.pool.query<ActivityRow[]>(sql, pageParams)
    const data = rows.map((row) => jsonValue<{ id?: string }>(row.data))
    const last = data[data.length - 1]
    return {
      rows: data,
      total,
      nextCursor: q.mode === 'cursor' && data.length === limit && last?.id ? last.id : null,
    }
  }

  async ping(): Promise<boolean> {
    try {
      await this.pool.query('select 1')
      return true
    } catch {
      return false
    }
  }

  async close(): Promise<void> {
    await this.pool.end()
  }
}
