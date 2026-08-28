import { useEffect, useRef, useState } from 'react'
import { apiEnabled, api } from '@/api/client'
import { useDataRefreshRevision } from '@/api/refresh'
import { usePagedRows, type PagedRows } from './usePagedRows'

export interface PagedSource<T> extends PagedRows<T> {
  pageCount: number
  loading: boolean
}

/**
 * Server-side **cursor (keyset)** pagination + search when API mode is on — fetches
 * one page from `endpoint?mode=cursor&limit=&cursor=&search=&…extraParams` and walks
 * pages with a cursor stack (so prev/next map onto keyset cursors, stable under
 * inserts). In local mode it pages the hydrated `localRows` client-side. Same
 * interface either way, so a page renders it without caring which mode is active.
 */
export function usePagedSource<T>(args: {
  localRows: T[]
  endpoint: string
  searchText?: (r: T) => string
  extraParams?: Record<string, string | undefined>
  pageSize?: number
  /** Bump to force a refetch (e.g. after a mutation). */
  refreshKey?: number | string
  /**
   * Normalize a raw API row into the page's view-model `T`. Needed when the list
   * endpoint's wire shape differs from the frontend selector shape (e.g. the backend
   * returns a flat expense `{ ...e, paidPaise }` but the table renders `r.expense`).
   * When the shapes already match (Payments, Users, Attendance) omit this.
   */
  mapApiRow?: (raw: unknown) => T
}): PagedSource<T> {
  const { localRows, endpoint, searchText, extraParams, pageSize = 25, refreshKey, mapApiRow } = args
  // Server-driven only when API mode is on AND an endpoint is given.
  const isApi = apiEnabled() && !!endpoint
  const dataRefreshRevision = useDataRefreshRevision()

  // Always call both hooks (rules of hooks); pick the active one by mode.
  const local = usePagedRows(localRows, { pageSize, searchText })

  const [rows, setRows] = useState<T[]>([])
  const [total, setTotal] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [page, setPageState] = useState(1)
  const [size, setSize] = useState(pageSize)
  const [search, setSearch] = useState('')
  // `search` is the immediate UI value (keeps the input responsive); the fetch keys off
  // the debounced copy so typing doesn't fire a request per keystroke.
  const [debouncedSearch, setDebouncedSearch] = useState('')
  // cursorStack[i] = the cursor that fetches page (i+1); page 1 has no cursor.
  const cursorStack = useRef<(string | undefined)[]>([undefined])
  const extraKey = JSON.stringify(extraParams ?? {})

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 300)
    return () => clearTimeout(t)
  }, [search])

  // A new search / page-size / filter restarts the keyset walk at page 1.
  useEffect(() => {
    cursorStack.current = [undefined]
    setPageState(1)
  }, [debouncedSearch, size, extraKey])

  useEffect(() => {
    if (!isApi) return
    let cancelled = false
    setLoading(true)
    const params = new URLSearchParams({ mode: 'cursor', limit: String(size) })
    const cursor = cursorStack.current[page - 1]
    if (cursor) params.set('cursor', cursor)
    if (debouncedSearch.trim()) params.set('search', debouncedSearch.trim())
    for (const [k, v] of Object.entries(extraParams ?? {})) if (v) params.set(k, v)
    api
      .raw<{ data: unknown[]; total?: number; nextCursor?: string | null }>(`${endpoint}?${params.toString()}`)
      .then((res) => {
        if (cancelled) return
        // If a refetch shrank the result set (e.g. deleting the last row on the last
        // page), this page is now empty — step back so the user isn't stranded on a
        // blank page reading "Page 3 of 2". The previous page's cursor is already known.
        if (res.data.length === 0 && page > 1) {
          setPageState((p) => Math.max(1, p - 1))
          return
        }
        setRows(mapApiRow ? res.data.map(mapApiRow) : (res.data as T[]))
        setTotal(res.total ?? res.data.length)
        setNextCursor(res.nextCursor ?? null)
      })
      .catch(() => {
        if (!cancelled) { setRows([]); setNextCursor(null) }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isApi, endpoint, page, size, debouncedSearch, extraKey, refreshKey, dataRefreshRevision])

  // prev/next only (what TablePager offers) — next consumes the keyset cursor.
  const setPage = (p: number) => {
    if (p === page + 1) {
      if (nextCursor == null) return
      cursorStack.current[page] = nextCursor // cursor for the page we're moving to
      setPageState(p)
    } else if (p >= 1 && p < page) {
      setPageState(p)
    }
  }

  if (!isApi) return { ...local, loading: false }
  return {
    pageRows: rows,
    total,
    page,
    setPage,
    pageSize: size,
    setPageSize: setSize,
    pageCount: Math.max(1, Math.ceil(total / size)),
    search,
    setSearch,
    loading,
  }
}
