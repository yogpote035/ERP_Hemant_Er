/**
 * Shared list helper — server-side search + pagination for every GET list endpoint.
 *
 * Backward-compatible: with NO `page`/`pageSize` query params it returns ALL rows
 * (so the frontend's hydrate-everything path keeps working), still honouring
 * `search`. With pagination params it returns just that page plus the envelope
 * { total, page, pageSize, totalPages }. `total` is always the post-search count.
 */
import { z } from 'zod'

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
  search: z.string().trim().optional(),
})
export type ListQuery = z.infer<typeof listQuerySchema>

export interface ListResult<T> {
  data: T[]
  total: number
  page?: number
  pageSize?: number
  totalPages?: number
}

// ── cursor (keyset) pagination ────────────────────────────────────────────────
export const cursorQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  search: z.string().trim().optional(),
})
export interface CursorResult<T> {
  data: T[]
  nextCursor: string | null
  hasMore: boolean
  total: number
}

/**
 * Cursor (keyset) pagination — stable under inserts and O(page) rather than O(offset):
 * return the `limit` rows AFTER the row whose id equals `cursor` (or from the start
 * when no cursor), plus the `nextCursor` to fetch the following page. `idOf` extracts
 * the stable key (rows may be view-model wrappers, e.g. `r.inward.id`).
 */
export function cursorList<T>(
  rows: T[],
  rawQuery: unknown,
  opts: { idOf: (r: T) => string; searchText?: (r: T) => string }
): CursorResult<T> {
  const q = cursorQuerySchema.parse(rawQuery)
  let filtered = rows
  if (q.search && opts.searchText) {
    const needle = q.search.toLowerCase()
    filtered = rows.filter((r) => opts.searchText!(r).toLowerCase().includes(needle))
  }
  const total = filtered.length
  const limit = q.limit ?? 25
  let start = 0
  if (q.cursor) {
    const i = filtered.findIndex((r) => opts.idOf(r) === q.cursor)
    start = i >= 0 ? i + 1 : 0
  }
  const data = filtered.slice(start, start + limit)
  const hasMore = start + limit < total
  const last = data[data.length - 1]
  return { data, nextCursor: hasMore && last ? opts.idOf(last) : null, hasMore, total }
}

/**
 * Filter `rows` by `search` (against `searchText(row)`, case-insensitive) then
 * paginate per the query. Extra query keys (e.g. from/to) are ignored here — apply
 * those filters BEFORE calling this.
 */
/** Join a flat entity's string/number fields for generic search (raw masters etc.). */
export function genericSearchText(row: Record<string, unknown>): string {
  const out: string[] = []
  for (const v of Object.values(row)) {
    if (typeof v === 'string' || typeof v === 'number') out.push(String(v))
    else if (Array.isArray(v)) for (const x of v) if (typeof x === 'string' || typeof x === 'number') out.push(String(x))
  }
  return out.join(' ')
}

export function buildList<T>(rows: T[], rawQuery: unknown, searchText?: (r: T) => string): ListResult<T> {
  const q = listQuerySchema.parse(rawQuery)
  let filtered = rows
  if (q.search && searchText) {
    const needle = q.search.toLowerCase()
    filtered = rows.filter((r) => searchText(r).toLowerCase().includes(needle))
  }
  const total = filtered.length
  if (q.page == null && q.pageSize == null) return { data: filtered, total }
  const page = q.page ?? 1
  const pageSize = q.pageSize ?? 50
  const start = (page - 1) * pageSize
  return {
    data: filtered.slice(start, start + pageSize),
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
  }
}
