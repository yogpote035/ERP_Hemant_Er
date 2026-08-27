import { useEffect, useMemo, useState } from 'react'

export interface PagedRows<T> {
  /** The rows for the current page (after search + pagination). */
  pageRows: T[]
  /** Total rows after search (before pagination). */
  total: number
  page: number
  setPage: (p: number) => void
  pageSize: number
  setPageSize: (n: number) => void
  pageCount: number
  search: string
  setSearch: (s: string) => void
}

/**
 * Client-side search + pagination over an in-memory row array (the app hydrates
 * the whole book into the store, so list pages page/search locally). The backend
 * also supports `?page=&pageSize=&search=` for a future server-driven mode.
 */
export function usePagedRows<T>(
  rows: T[],
  opts: { pageSize?: number; searchText?: (r: T) => string } = {}
): PagedRows<T> {
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(opts.pageSize ?? 25)
  const { searchText } = opts

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q || !searchText) return rows
    return rows.filter((r) => searchText(r).toLowerCase().includes(q))
  }, [rows, search, searchText])

  const total = filtered.length
  const pageCount = Math.max(1, Math.ceil(total / pageSize))
  const current = Math.min(page, pageCount)

  // Snap back to page 1 whenever the filter or page size shrinks the result set.
  useEffect(() => {
    setPage(1)
  }, [search, pageSize])

  const pageRows = useMemo(
    () => filtered.slice((current - 1) * pageSize, (current - 1) * pageSize + pageSize),
    [filtered, current, pageSize]
  )

  return { pageRows, total, page: current, setPage, pageSize, setPageSize, pageCount, search, setSearch }
}
