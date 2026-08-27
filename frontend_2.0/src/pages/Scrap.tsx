import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Recycle, Pencil, Trash2 } from 'lucide-react'
import { formatINRSymbol, fromPaise, toPaise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import { computeScrap } from '@/lib/scrapMath'
import type { ScrapBill } from '@/types/domain'
import { useStore } from '@/store'
import type { Paise } from '@/lib/money'
import { customerOptions, unitOptions } from '@/masters/options'
import { runSaveScrapBill, runDeleteScrapBill } from '@/store/scrapCommands'
import { selectScrapRows, selectScrapTotals, type ScrapRow } from '@/selectors/finance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Badge, Button, Card, ConfirmDialog, EmptyState, Kpi, KpiGrid, SearchableDropdown, TablePager } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'

const numOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}

export default function Scrap() {
  const can = useCan()
  const canCreate = can('scrap', 'create')
  const canEdit = can('scrap', 'edit')
  const units = useStore(unitOptions)
  const customers = useStore(customerOptions)
  const rows = useStore(useShallow(selectScrapRows))
  const totals = useStore(selectScrapTotals)

  const [editingId, setEditingId] = useState<string | null>(null)
  const [unitId, setUnitId] = useState('')
  const [customerId, setCustomerId] = useState('')
  const [invoiceNo, setInvoiceNo] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(todayISO())
  const [periodFrom, setPeriodFrom] = useState('')
  const [periodTo, setPeriodTo] = useState('')
  const [kg, setKg] = useState('')
  const [rate, setRate] = useState('')
  const [gst, setGst] = useState('18')
  const [tcs, setTcs] = useState('1')
  const [submitting, setSubmitting] = useState(false)
  const [deleting, setDeleting] = useState<ScrapBill | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const calc = useMemo(
    () => computeScrap(Math.round(numOf(kg) * 1000), toPaise(numOf(rate)), numOf(gst), numOf(tcs)),
    [kg, rate, gst, tcs]
  )
  // Server-driven table in API mode; bump after a write so the fetched page reflects it.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)
  const paged = usePagedSource({
    localRows: rows,
    endpoint: '/scrap',
    searchText: (r) => `${r.bill.scrapInvoiceNo ?? ''} ${r.customerName ?? ''}`,
    pageSize: 25,
    refreshKey,
    // GET /scrap returns a FLAT bill + { customerName, totals }; re-nest into ScrapRow.
    mapApiRow: (raw): ScrapRow => {
      const b = raw as ScrapBill & { customerName?: string; totals: { grand: Paise } }
      return { bill: b, customerName: b.customerName ?? '—', grand: b.totals.grand }
    },
  })

  // After a fresh CREATE we keep unit/customer/period so several bills for the same
  // customer-period can be entered quickly — only the per-bill fields clear.
  function clearLineFields() {
    setInvoiceNo('')
    setKg('')
    setRate('')
  }
  // Leaving edit mode (save-edit, cancel, or delete-of-edited) must FULLY reset, or the
  // edited bill's unit/customer/period/GST would bleed into the next "new" bill and be
  // saved as a GST+TCS document against the wrong tax party / period.
  function resetForm() {
    setEditingId(null)
    setUnitId('')
    setCustomerId('')
    setInvoiceDate(todayISO())
    setPeriodFrom('')
    setPeriodTo('')
    setGst('18')
    setTcs('1')
    clearLineFields()
  }

  function loadForEdit(bill: ScrapBill) {
    setEditingId(bill.id)
    setUnitId(bill.unitId)
    setCustomerId(bill.customerId)
    setInvoiceNo(bill.scrapInvoiceNo)
    setInvoiceDate(bill.invoiceDate)
    setPeriodFrom(bill.periodFrom)
    setPeriodTo(bill.periodTo)
    setKg(String(bill.weightGrams / 1000))
    setRate(String(fromPaise(bill.ratePerKgPaise)))
    setGst(String(bill.gstPct))
    setTcs(String(bill.tcsPct))
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveScrapBill({
        id: editingId ?? undefined,
        unitId,
        customerId,
        periodFrom: periodFrom || invoiceDate,
        periodTo: periodTo || invoiceDate,
        weightGrams: Math.round(numOf(kg) * 1000),
        ratePerKgPaise: toPaise(numOf(rate)),
        gstPct: numOf(gst),
        tcsPct: numOf(tcs),
        scrapInvoiceNo: invoiceNo.trim(),
        invoiceDate,
      })
      toastCommandSuccess(editingId ? 'Scrap bill updated' : 'Scrap bill saved', res.cascade)
      if (editingId) resetForm()
      else clearLineFields()
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteScrapBill(deleting.id)
      toastCommandSuccess('Scrap bill deleted', res.cascade)
      if (editingId === deleting.id) resetForm()
      setDeleting(null)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Scrap bills</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">Period-wise scrap sales · GST + TCS @ 1%.</p>
      </div>

      <KpiGrid className="lg:grid-cols-3">
        <Kpi tone="blue" label="Scrap sold" value={`${(totals.weightGrams / 1000).toLocaleString('en-IN')} kg`} />
        <Kpi tone="green" label="Scrap revenue" value={formatINRSymbol(totals.revenue)} sub="incl. GST + TCS" />
        <Kpi tone="amber" label="TCS collected" value={formatINRSymbol(totals.tcs)} />
      </KpiGrid>

      {canCreate || editingId ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">{editingId ? `Edit scrap bill ${invoiceNo}` : 'New scrap bill'}</div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fld label="Unit">
                <SearchableDropdown
                  aria-label="Unit"
                  value={unitId}
                  onChange={(v) => setUnitId(v)}
                  options={units}
                  placeholder="Select unit…"
                />
              </Fld>
              <Fld label="Customer">
                <SearchableDropdown
                  aria-label="Customer"
                  value={customerId}
                  onChange={(v) => setCustomerId(v)}
                  options={customers}
                  placeholder="Select customer…"
                />
              </Fld>
              <Fld label="Invoice no"><input className="input h-9" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} /></Fld>
              <Fld label="Invoice date"><input type="date" className="input h-9" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} /></Fld>
              <Fld label="Period from"><input type="date" className="input h-9" value={periodFrom} onChange={(e) => setPeriodFrom(e.target.value)} /></Fld>
              <Fld label="Period to"><input type="date" className="input h-9" value={periodTo} onChange={(e) => setPeriodTo(e.target.value)} /></Fld>
              <Fld label="Weight (kg)"><input type="number" min={0} className="input h-9" value={kg} onChange={(e) => setKg(e.target.value)} /></Fld>
              <Fld label="Rate / kg (₹)"><input type="number" min={0} step="0.01" className="input h-9" value={rate} onChange={(e) => setRate(e.target.value)} /></Fld>
              <Fld label="GST %"><input type="number" min={0} className="input h-9" value={gst} onChange={(e) => setGst(e.target.value)} /></Fld>
              <Fld label="TCS %"><input type="number" min={0} step="0.01" className="input h-9" value={tcs} onChange={(e) => setTcs(e.target.value)} /></Fld>
            </div>
            <div className="grid grid-cols-2 gap-3 border-t border-border pt-3 sm:grid-cols-4" aria-live="polite" aria-label="Scrap calculation">
              <Calc label="Value" value={formatINRSymbol(calc.value)} />
              <Calc label="GST" value={formatINRSymbol(calc.gst)} />
              <Calc label="TCS @ 1%" value={formatINRSymbol(calc.tcs)} />
              <Calc label="Total invoice" value={formatINRSymbol(calc.grand)} primary />
            </div>
            <div className="flex justify-end gap-2">
              {editingId ? (
                <Button variant="secondary" onClick={resetForm} disabled={submitting}>Cancel edit</Button>
              ) : null}
              <Button onClick={onSave} loading={submitting} disabled={!unitId || !customerId || !invoiceNo.trim() || numOf(kg) <= 0 || numOf(rate) <= 0}>
                {editingId ? 'Save changes' : 'Save scrap bill'}
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={Recycle} title="No scrap bills" description="Record a scrap sale above." /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Recent scrap invoices</span>
            <input
              className="input h-9 w-56 ml-auto"
              placeholder="Search…"
              aria-label="Search"
              value={paged.search}
              onChange={(e) => paged.setSearch(e.target.value)}
            />
          </div>
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Invoice</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Weight (kg)</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr key={r.bill.id} className={'border-b border-border/60 hover:bg-muted/40' + (editingId === r.bill.id ? ' bg-primary/5' : '')}>
                  <td className="px-3 py-2.5 mono font-medium">{r.bill.scrapInvoiceNo}</td>
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.bill.invoiceDate)}</td>
                  <td className="px-3 py-2.5">{r.customerName}</td>
                  <td className="px-3 py-2.5 text-right mono">{(r.bill.weightGrams / 1000).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.grand)}</td>
                  <td className="px-3 py-2.5"><Badge tone={r.bill.status === 'paid' ? 'success' : r.bill.status === 'partial' ? 'warning' : 'primary'} className="capitalize">{r.bill.status}</Badge></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {canEdit ? (
                        <Button size="sm" variant="ghost" aria-label={`Edit ${r.bill.scrapInvoiceNo}`} title="Edit" onClick={() => loadForEdit(r.bill)}><Pencil size={14} /></Button>
                      ) : null}
                      {can('scrap', 'delete') ? (
                        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete ${r.bill.scrapInvoiceNo}`} title="Delete" onClick={() => setDeleting(r.bill)}><Trash2 size={14} /></Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        loading={deleteBusy}
        tone="danger"
        title="Delete scrap bill?"
        confirmLabel="Delete"
        message={
          deleting ? (
            <>Delete scrap invoice <b>{deleting.scrapInvoiceNo}</b> ({formatINRSymbol(computeScrap(deleting.weightGrams, deleting.ratePerKgPaise, deleting.gstPct, deleting.tcsPct).grand)})? This can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-fg">{label}</span>
      {children}
    </label>
  )
}
function Calc({ label, value, primary }: { label: string; value: string; primary?: boolean }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] text-muted-fg">{label}</span>
      <span className={'mono text-base font-bold ' + (primary ? 'text-primary' : '')}>{value}</span>
    </div>
  )
}
