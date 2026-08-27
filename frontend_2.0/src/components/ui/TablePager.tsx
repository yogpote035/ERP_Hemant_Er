import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'

const SIZES = [10, 25, 50, 100]

/** Footer pager for list tables: range summary, page-size select, prev/next. */
export function TablePager({
  page,
  pageCount,
  total,
  pageSize,
  onPage,
  onPageSize,
  className = '',
}: {
  page: number
  pageCount: number
  total: number
  pageSize: number
  onPage: (p: number) => void
  onPageSize: (n: number) => void
  className?: string
}) {
  if (total === 0) return null
  const from = (page - 1) * pageSize + 1
  const to = Math.min(page * pageSize, total)
  return (
    <div className={`flex flex-wrap items-center justify-between gap-3 border-t border-border px-3 py-2 text-[12px] text-muted-fg ${className}`}>
      <div className="flex items-center gap-2">
        <span>
          {from.toLocaleString('en-IN')}–{to.toLocaleString('en-IN')} of {total.toLocaleString('en-IN')}
        </span>
        <div className="relative ml-2">
          <select
            value={pageSize}
            onChange={(e) => onPageSize(Number(e.target.value))}
            aria-label="Rows per page"
            className="h-7 appearance-none rounded-md border border-border bg-card pl-2 pr-6 text-[12px] text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          >
            {SIZES.map((s) => (
              <option key={s} value={s}>
                {s} / page
              </option>
            ))}
          </select>
          <ChevronDown
            size={13}
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-muted-fg"
            aria-hidden
          />
        </div>
      </div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          aria-label="Previous page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <span className="px-1 tabular-nums">
          Page {page} of {pageCount}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= pageCount}
          aria-label="Next page"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-border hover:bg-muted disabled:opacity-40"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  )
}
