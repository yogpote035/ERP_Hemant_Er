import { useEffect, useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Boxes, X } from 'lucide-react'
import { useStore } from '@/store'
import { scopedInwards } from '@/store/scope'
import { values } from '@/store/normalized'
import { selectStockRows, latestProductionRatePaise } from '@/selectors/register'
import { selectPartLedger } from '@/selectors/stock'
import { addP, mulQty, formatINRCompact, type Paise } from '@/lib/money'
import { formatDMY } from '@/lib/date'
import type { Id } from '@/types/domain'
import { apiEnabled, api } from '@/api/client'
import { Badge, Card, EmptyState, Kpi, KpiGrid, Modal, TablePager } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'

const LOW_STOCK = 100 // reorder threshold (pcs)
const intFmt = (n: number) => Math.round(n).toLocaleString('en-IN')

interface StockSummary { available: number; disposed: number; lowStock: number; activeParts: number; value: number; skus: number; heats: number }

/** Live derived stock per (unit, part) — Opening + Inward − Outward − Disposed.
 *  In API mode the table is fetched page-by-page from the backend (server-side
 *  pagination + search) and KPIs come from GET /stock/summary; in local mode it
 *  pages the hydrated rows client-side. */
export default function Stock({ embedded = false }: { embedded?: boolean }) {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [drill, setDrill] = useState<{ unitId: Id; partId: Id; partNo: string } | null>(null)
  const rows = useStore(useShallow((s) => selectStockRows(s, from || undefined, to || undefined)))
  const unitsById = useStore((s) => s.masters.units.byId)
  const heats = useStore(
    useShallow((s) => new Set(scopedInwards(s).map((i) => i.batchHeatNo).filter(Boolean)).size)
  )
  const rateByPart = useStore(
    useShallow((s) => {
      const m: Record<Id, Paise> = {}
      for (const p of values(s.masters.parts)) {
        const r = latestProductionRatePaise(s, p.id)
        if (r != null) m[p.id] = r
      }
      return m
    })
  )

  // Local KPI computation (used in local mode, and as the fallback while the API summary loads).
  const localKpis = useMemo<StockSummary>(() => {
    let available = 0
    let disposed = 0
    let lowStock = 0
    let activeParts = 0
    let value = 0 as Paise
    for (const r of rows) {
      available += Math.max(0, r.available)
      disposed += r.disposed
      if (r.available <= LOW_STOCK) lowStock++
      if (r.available > 0) {
        activeParts++
        const rate = rateByPart[r.partId]
        if (rate != null) value = addP(value, mulQty(rate, r.available))
      }
    }
    return { available, disposed, lowStock, activeParts, value, skus: rows.length, heats }
  }, [rows, rateByPart, heats])

  // In API mode, KPIs come from the backend summary (whole dataset, not just the page).
  const [apiSummary, setApiSummary] = useState<StockSummary | null>(null)
  useEffect(() => {
    if (!apiEnabled()) return
    let cancelled = false
    const p = new URLSearchParams()
    if (from) p.set('from', from)
    if (to) p.set('to', to)
    api
      .raw<{ data: StockSummary }>(`/stock/summary?${p.toString()}`)
      .then((r) => !cancelled && setApiSummary(r.data))
      .catch(() => !cancelled && setApiSummary(null))
    return () => { cancelled = true }
  }, [from, to])
  const kpis = apiEnabled() && apiSummary ? apiSummary : localKpis

  const paged = usePagedSource({
    localRows: rows,
    endpoint: '/stock',
    searchText: (r) => r.partNo,
    extraParams: { from: from || undefined, to: to || undefined },
    pageSize: 25,
  })

  const hasFilter = from !== '' || to !== ''

  return (
    <div className="space-y-4">
      {!embedded ? (
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Inventory Stock</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Live heat-wise stock derived from openings, inwards and dispatches — never stored.</p>
        </div>
      ) : null}

      <KpiGrid>
        <Kpi tone="blue" label="Total Available" value={intFmt(kpis.available)} sub={`${kpis.skus} SKU${kpis.skus === 1 ? '' : 's'}`} />
        <Kpi tone="purple" label="Active Part Numbers" value={intFmt(kpis.activeParts)} sub="available stock > 0" />
        <Kpi tone="green" label="Total Stock Value" value={formatINRCompact(kpis.value as Paise)} sub="available × latest rate" />
        <Kpi tone="amber" label="Disposed / Scrap" value={intFmt(kpis.disposed)} sub="MR + MF, removed" />
      </KpiGrid>
      <KpiGrid>
        <Kpi tone="green" label="Heats Tracked" value={intFmt(kpis.heats)} sub="active batches" />
        <Kpi tone="red" label="Low Stock Alerts" value={intFmt(kpis.lowStock)} sub={`at / below ${LOW_STOCK} pcs`} />
      </KpiGrid>

      <Card className="flex flex-wrap items-end gap-3 p-3">
        <input
          className="input h-9 w-56"
          placeholder="Search part no…"
          aria-label="Search"
          value={paged.search}
          onChange={(e) => paged.setSearch(e.target.value)}
        />
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-fg">
          Movement from
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} aria-label="Stock movement from date" className="h-9 rounded-md border border-border bg-card px-2 text-[13px] text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </label>
        <label className="flex flex-col gap-1 text-[11px] font-medium text-muted-fg">
          Movement to
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} aria-label="Stock movement to date" className="h-9 rounded-md border border-border bg-card px-2 text-[13px] text-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30" />
        </label>
        {hasFilter ? (
          <button type="button" onClick={() => { setFrom(''); setTo('') }} className="inline-flex h-9 items-center gap-1 rounded-md border border-border px-2.5 text-[12.5px] text-muted-fg hover:bg-muted">
            <X className="h-3.5 w-3.5" /> Clear
          </button>
        ) : null}
        {hasFilter ? (
          <span className="text-[11.5px] text-muted-fg">Showing movement in the selected period (Available = Opening + Inward − Outward − Disposed in period).</span>
        ) : null}
      </Card>

      {paged.total === 0 ? (
        <Card>
          <EmptyState icon={Boxes} title={paged.search ? 'No matches' : 'No stock to show'} description={paged.search ? 'No parts match your search.' : 'Add parts, opening stock or inward challans first.'} />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Unit</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Opening</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Inward</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Outward</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Disposed / Scrap</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Available</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Reconcile</th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr
                  key={`${r.unitId}:${r.partId}`}
                  className="cursor-pointer border-b border-border/60 hover:bg-muted/40"
                  onClick={() => setDrill({ unitId: r.unitId, partId: r.partId, partNo: r.partNo })}
                  title="View the inward / outward ledger for this part"
                >
                  <td className="px-3 py-2.5">{unitsById[r.unitId]?.code ?? r.unitId}</td>
                  <td className="px-3 py-2.5 font-medium text-primary underline-offset-2 hover:underline">{r.partNo}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.opening.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.received.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.outward.toLocaleString('en-IN')}</td>
                  <td className={`px-3 py-2.5 text-right mono ${r.disposed ? 'font-semibold text-danger' : 'text-muted-fg'}`}>{r.disposed.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{r.available.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5">
                    {r.balanced ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Imbalanced</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      {drill ? (
        <StockLedgerModal unitId={drill.unitId} partId={drill.partId} partNo={drill.partNo} unitCode={unitsById[drill.unitId]?.code ?? drill.unitId} onClose={() => setDrill(null)} />
      ) : null}
    </div>
  )
}

/** Drill-down: chronological inward/outward ledger for one (unit, part) with a running balance. */
function StockLedgerModal({ unitId, partId, partNo, unitCode, onClose }: { unitId: Id; partId: Id; partNo: string; unitCode: string; onClose: () => void }) {
  const ledger = useStore(useShallow((s) => selectPartLedger(s, unitId, partId)))
  const totals = ledger.reduce((a, e) => ({ in: a.in + e.qtyIn, out: a.out + e.qtyOut }), { in: 0, out: 0 })
  const balance = ledger.at(-1)?.balance ?? 0
  return (
    <Modal open onClose={onClose} size="xl" title={`Stock ledger — ${partNo}`} description={`${unitCode} · ${ledger.length} transaction${ledger.length === 1 ? '' : 's'} · balance ${intFmt(balance)}`}>
      {ledger.length === 0 ? (
        <EmptyState icon={Boxes} title="No transactions" description="No opening stock, inward or outward movements for this part yet." />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-semibold">Date</th>
                <th className="px-3 py-2 font-semibold">Type</th>
                <th className="px-3 py-2 font-semibold">Reference</th>
                <th className="px-3 py-2 text-right font-semibold">In</th>
                <th className="px-3 py-2 text-right font-semibold">Out</th>
                <th className="px-3 py-2 text-right font-semibold">Balance</th>
              </tr>
            </thead>
            <tbody>
              {ledger.map((e, i) => (
                <tr key={i} className="border-t border-border/60">
                  <td className="px-3 py-1.5 mono text-muted-fg">{e.date ? formatDMY(e.date) : '—'}</td>
                  <td className="px-3 py-1.5">
                    <Badge tone={e.kind === 'inward' ? 'success' : e.kind === 'outward' ? 'primary' : 'warning'} className="capitalize">{e.kind}</Badge>
                    {e.detail ? <span className="ml-1.5 text-[11px] text-faint">{e.detail}</span> : null}
                  </td>
                  <td className="px-3 py-1.5 mono">{e.ref}</td>
                  <td className="px-3 py-1.5 text-right mono text-success">{e.qtyIn ? `+${intFmt(e.qtyIn)}` : ''}</td>
                  <td className="px-3 py-1.5 text-right mono text-danger">{e.qtyOut ? `−${intFmt(e.qtyOut)}` : ''}</td>
                  <td className="px-3 py-1.5 text-right mono font-semibold">{intFmt(e.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted font-bold">
                <td className="px-3 py-2" colSpan={3}>Totals</td>
                <td className="px-3 py-2 text-right mono text-success">+{intFmt(totals.in)}</td>
                <td className="px-3 py-2 text-right mono text-danger">−{intFmt(totals.out)}</td>
                <td className="px-3 py-2 text-right mono">{intFmt(balance)}</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}
    </Modal>
  )
}
