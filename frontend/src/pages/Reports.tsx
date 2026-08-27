import { useMemo, useState, type ReactNode } from 'react'
import {
  Search, Download, FileSpreadsheet, Printer, ArrowLeftRight, ReceiptText,
  TrendingUp, Boxes, Recycle, Banknote, CalendarClock, BarChart3, CalendarRange,
  type LucideIcon,
} from 'lucide-react'
import { toast } from 'sonner'
import { useStore, currentUser } from '@/store'
import { REPORTS, reportByKey, type ReportColumn, type ReportRow, type ReportDef } from '@/selectors/reports'
import { Button, Card, Drawer, EmptyState } from '@/components/ui'

type Category = 'Operations' | 'Finance' | 'Workforce'
interface Meta { category: Category; description: string; icon: LucideIcon }

/** UI metadata for each report (icons/category/blurb live here, not in the data layer). */
const META: Record<string, Meta> = {
  'inward-outward': { category: 'Operations', icon: ArrowLeftRight, description: 'Goods-received challans against dispatches per part, with running balance.' },
  'billing-summary': { category: 'Finance', icon: ReceiptText, description: 'Every GST invoice by Bill No — status, grand total and outstanding.' },
  'customer-revenue': { category: 'Finance', icon: TrendingUp, description: 'Invoiced, collected and outstanding amounts aggregated per customer.' },
  stock: { category: 'Operations', icon: Boxes, description: 'Live derived closing stock and reconcile health per unit & part.' },
  scrap: { category: 'Finance', icon: Recycle, description: 'Scrap sale invoices with weight, TCS and grand total.' },
  expenses: { category: 'Finance', icon: Banknote, description: 'Overhead expenses with paid / balance and ageing status.' },
  'attendance-earnings': { category: 'Workforce', icon: CalendarClock, description: 'Production-piece and shift earnings rolled up per employee.' },
}
const metaOf = (key: string): Meta => META[key] ?? { category: 'Operations', icon: BarChart3, description: '' }

const CAT_TONE: Record<Category, string> = {
  Operations: 'bg-primary/10 text-primary',
  Finance: 'bg-success/15 text-success',
  Workforce: 'bg-accent/15 text-accent',
}
const TABS: ('All' | Category)[] = ['All', 'Operations', 'Finance', 'Workforce']

export default function Reports() {
  const [tab, setTab] = useState<'All' | Category>('All')
  const [q, setQ] = useState('')
  const [openKey, setOpenKey] = useState<string | null>(null)

  // Row counts for the card badges — a one-shot point-in-time snapshot (reports
  // are deliberately a snapshot view; reopening the page recomputes).
  const counts = useMemo(
    () => Object.fromEntries(REPORTS.map((r) => [r.key, r.build(useStore.getState(), {}).rows.length])) as Record<string, number>,
    []
  )
  const catCounts = useMemo(() => {
    const c: Record<string, number> = { All: REPORTS.length, Operations: 0, Finance: 0, Workforce: 0 }
    for (const r of REPORTS) {
      const cat = metaOf(r.key).category
      c[cat] = (c[cat] ?? 0) + 1
    }
    return c
  }, [])

  const ql = q.trim().toLowerCase()
  const visible = REPORTS.filter((r) => {
    const m = metaOf(r.key)
    if (tab !== 'All' && m.category !== tab) return false
    if (ql && !(r.label.toLowerCase().includes(ql) || m.description.toLowerCase().includes(ql))) return false
    return true
  })

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Reports &amp; analytics</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">
            {REPORTS.length} reports · registers, billing &amp; customer summaries, stock, scrap, expenses and payroll — scoped to your units.
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search reports…"
            aria-label="Search reports"
            className="input h-9 pl-8"
          />
        </div>
      </div>

      {/* Category tabs */}
      <div className="flex flex-wrap gap-1 border-b border-border">
        {TABS.map((t) => (
          <TabButton key={t} active={tab === t} onClick={() => setTab(t)} count={catCounts[t] ?? 0}>
            {t}
          </TabButton>
        ))}
      </div>

      {/* Card grid */}
      {visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No reports match"
            description="Try a different search or category."
            action={<Button variant="secondary" onClick={() => { setQ(''); setTab('All') }}>Clear filters</Button>}
          />
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((r) => (
            <ReportCard key={r.key} def={r} rows={counts[r.key] ?? 0} onOpen={() => setOpenKey(r.key)} />
          ))}
        </div>
      )}

      {openKey ? <ReportDrawer key={openKey} def={reportByKey(openKey)!} onClose={() => setOpenKey(null)} /> : null}
    </div>
  )
}

function TabButton({ active, onClick, count, children }: { active: boolean; onClick: () => void; count: number; children: ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium transition ${
        active ? 'border-primary text-primary' : 'border-transparent text-muted-fg hover:text-fg'
      }`}
    >
      {children}
      <span className={`rounded-full px-1.5 text-[10.5px] tabular-nums ${active ? 'bg-primary/10 text-primary' : 'bg-muted text-muted-fg'}`}>{count}</span>
    </button>
  )
}

function ReportCard({ def, rows, onOpen }: { def: ReportDef; rows: number; onOpen: () => void }) {
  const m = metaOf(def.key)
  const Icon = m.icon
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 text-left shadow-sm transition-all hover:border-primary/40 hover:shadow-md focus-visible:ring-2 focus-visible:ring-ring"
    >
      <div className="flex w-full items-start justify-between gap-2">
        <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-lg ${CAT_TONE[m.category]}`}>
          <Icon size={18} />
        </span>
        <span className={`badge ${CAT_TONE[m.category]}`}>{m.category}</span>
      </div>
      <div className="min-w-0">
        <div className="text-[15px] font-semibold leading-tight">{def.label}</div>
        <p className="mt-1 line-clamp-2 text-[12.5px] text-muted-fg">{m.description}</p>
      </div>
      <div className="mt-auto flex w-full items-center justify-between pt-1 text-[11.5px] text-faint">
        <span className="flex items-center gap-1.5">
          <span className="tabular-nums">{rows.toLocaleString('en-IN')}</span> rows
          {def.dateFiltered ? <span className="flex items-center gap-1 text-faint"><CalendarRange size={12} /> date</span> : null}
        </span>
        <span className="font-medium text-primary opacity-0 transition group-hover:opacity-100">Open →</span>
      </div>
    </button>
  )
}

function ReportDrawer({ def, onClose }: { def: ReportDef; onClose: () => void }) {
  const m = metaOf(def.key)
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [exporting, setExporting] = useState(false)
  const scope = useStore((s) => (currentUser(s)?.role === 'admin' ? 'All units' : `${currentUser(s)?.assignedUnitIds.length ?? 0} unit(s)`))

  const result = useMemo(
    () => def.build(useStore.getState(), { from: from || undefined, to: to || undefined }),
    [def, from, to]
  )
  const stamp = () => new Date().toISOString().slice(0, 10)

  async function exportExcel() {
    setExporting(true)
    try {
      const { exportRowsToXlsx } = await import('@/lib/exportXlsx')
      await exportRowsToXlsx(`${def.label} ${stamp()}.xlsx`, def.label, result.columns, result.rows)
      toast.success('Exported to Excel', { description: `${result.rows.length} rows` })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed')
    } finally {
      setExporting(false)
    }
  }
  function exportCsv() {
    downloadCsv(`${def.label} ${stamp()}.csv`, toCsv(result.columns, result.rows))
    toast.success('Exported to CSV', { description: `${result.rows.length} rows` })
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="xl"
      title={def.label}
      description={m.description}
    >
      <div className="space-y-4">
        {/* Action + filter bar */}
        <div className="flex flex-wrap items-end gap-2 print:hidden">
          <Button leftIcon={<FileSpreadsheet size={15} />} onClick={exportExcel} loading={exporting} disabled={result.rows.length === 0}>
            Export Excel
          </Button>
          <Button variant="secondary" leftIcon={<Download size={15} />} onClick={exportCsv} disabled={result.rows.length === 0}>
            Export CSV
          </Button>
          <Button variant="secondary" leftIcon={<Printer size={15} />} onClick={() => window.print()} disabled={result.rows.length === 0}>
            Print / PDF
          </Button>
          {def.dateFiltered ? (
            <div className="ml-auto flex items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-fg">From</span>
                <input type="date" className="input h-9" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="From date" />
              </label>
              <label className="flex flex-col gap-1">
                <span className="text-[11px] font-medium text-muted-fg">To</span>
                <input type="date" className="input h-9" value={to} onChange={(e) => setTo(e.target.value)} aria-label="To date" />
              </label>
              {from || to ? (
                <Button variant="ghost" size="sm" onClick={() => { setFrom(''); setTo('') }}>Clear</Button>
              ) : null}
            </div>
          ) : null}
        </div>

        {/* Config strip */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 print:hidden">
          <Detail label="Category" value={m.category} />
          <Detail label="Scope" value={scope} />
          <Detail label="Rows" value={result.rows.length.toLocaleString('en-IN')} />
          <Detail label="Date range" value={def.dateFiltered ? (from || to ? `${from || '…'} → ${to || '…'}` : 'All dates') : 'Not date-filtered'} />
        </div>

        {/* Table — the ONLY region that prints (see @media print in index.css) */}
        <div id="report-print">
          {/* Print-only header — the Drawer title/chrome are hidden when printing */}
          <div className="mb-3 hidden print:block">
            <h2 className="text-lg font-bold">{def.label}</h2>
            <p className="text-[12px] text-muted-fg">
              {scope}
              {def.dateFiltered ? ` · ${from || to ? `${from || '…'} → ${to || '…'}` : 'All dates'}` : ''}
              {` · ${result.rows.length.toLocaleString('en-IN')} rows`}
            </p>
          </div>
        {result.rows.length === 0 ? (
          <Card>
            <EmptyState icon={BarChart3} title="Nothing to report" description={def.dateFiltered ? 'No rows in this date range / scope.' : 'No data in your scope yet.'} />
          </Card>
        ) : (
          <Card className="overflow-x-auto p-0">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="sticky top-0 z-10 border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                  {result.columns.map((c) => (
                    <th key={c.key} scope="col" className={`px-3 py-2.5 font-semibold ${c.align === 'right' ? 'text-right' : ''}`}>
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border/60 last:border-0 hover:bg-muted/40">
                    {result.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2 ${c.align === 'right' ? 'text-right mono' : ''}`}>
                        {row[c.key] ?? '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        )}
        </div>
      </div>
    </Drawer>
  )
}

function Detail({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-border bg-muted/40 px-3 py-2">
      <div className="text-[10px] uppercase tracking-wide text-faint">{label}</div>
      <div className="truncate text-[13px] font-medium">{value}</div>
    </div>
  )
}

// ── CSV export (no dependency) ─────────────────────────────────────────────────
function toCsv(columns: ReportColumn[], rows: ReportRow[]): string {
  const esc = (v: unknown) => {
    let s = v == null ? '' : String(v)
    // Neutralize CSV/formula injection: a cell starting with = + - @ (or tab/CR) is
    // executed as a formula by Excel/Sheets. User-controlled master names flow here, so
    // prefix a single quote to force literal text before RFC-4180 quoting.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  const head = columns.map((c) => esc(c.label)).join(',')
  const body = rows.map((r) => columns.map((c) => esc(r[c.key])).join(',')).join('\n')
  return `${head}\n${body}`
}
function downloadCsv(name: string, csv: string): void {
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
}
