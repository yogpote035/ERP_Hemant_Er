import { useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronRight,
  ChevronDown,
  FileSpreadsheet,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  Search,
  Trash2,
  Truck,
} from 'lucide-react'
import { addP, formatINR, formatINRCompact, formatINRSymbol, fromPaise, mulQty, pctOfPaise, type Paise } from '@/lib/money'
import { getById } from '@/store/normalized'
import { formatDMY } from '@/lib/date'
import type { Dispatch, Id, Inward } from '@/types/domain'
import { useStore } from '@/store'
import { runSaveInward, runDeleteInward, runDeleteDispatch } from '@/store/registerCommands'
import { selectInwardRows, type DispatchChild, type InwardRow } from '@/selectors/register'
import { useCan } from '@/hooks/useCan'
import { inwardApi } from '@/api/modules'
import { apiEnabled } from '@/api/client'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { ActionMenu, Badge, Button, Card, Chip, ConfirmDialog, Drawer, EmptyState, Kpi, KpiGrid, SearchableDropdown, TablePager, Tabs, type ActionMenuItem } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'
import ImportWizard from '@/pages/ImportWizard'
import { RecordFormModal } from '@/components/form/RecordFormModal'
import { DispatchForm } from '@/components/register/DispatchForm'
import {
  inwardFields,
  inwardSchema,
  inwardDefaults,
  inwardToValues,
  inwardValuesToInput,
  type InwardFormValues,
} from '@/components/register/inwardForm'

type DeleteTarget = { kind: 'inward' | 'dispatch'; id: Id; label: string }
type TabKey = 'all' | 'open' | 'done'

const TABS = [
  { value: 'all', label: 'All receipts' },
  { value: 'open', label: 'Open balance' },
  { value: 'done', label: 'Fully dispatched' },
] as const

const intFmt = (n: number) => n.toLocaleString('en-IN')

export default function InwardRegister({
  embedded = false,
  onOpenOutward,
}: {
  embedded?: boolean
  /** When set, rows show an "Outward" action that opens the full Outward Entry screen for that challan. */
  onOpenOutward?: (inwardId: Id) => void
}) {
  const can = useCan()
  const rows = useStore(useShallow(selectInwardRows))
  const [params, setParams] = useSearchParams()
  const qRaw = params.get('q') ?? ''
  const q = qRaw.trim().toLowerCase()
  const setQuery = (v: string) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (v) p.set('q', v)
        else p.delete('q')
        return p
      },
      { replace: true }
    )
  const [tab, setTab] = useState<TabKey>('all')
  const [partFilter, setPartFilter] = useState<string>('all')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [expanded, setExpanded] = useState<Set<Id>>(new Set())
  const [inwardModal, setInwardModal] = useState<{ inward: Inward | null } | null>(null)
  const [dispatchModal, setDispatchModal] = useState<{ inward: Inward; dispatch: Dispatch | null } | null>(null)
  const [deleting, setDeleting] = useState<DeleteTarget | null>(null)

  const canInwardCreate = can('inward', 'create')
  const canInwardEdit = can('inward', 'edit')
  const canInwardDelete = can('inward', 'delete')
  const canDispatchCreate = can('dispatch', 'create')
  const canDispatchEdit = can('dispatch', 'edit')
  const canDispatchDelete = can('dispatch', 'delete')
  const canImport = can('import', 'view')
  const [importOpen, setImportOpen] = useState(false)

  // Date range (by challan date) bounds the KPIs AND the table; the search / part /
  // tab filters narrow only the table below.
  const dateFiltered = useMemo(
    () =>
      rows.filter((r) => {
        const d = r.inward.challanDate
        if (from && (!d || d < from)) return false
        if (to && (!d || d > to)) return false
        return true
      }),
    [rows, from, to]
  )

  const kpis = useMemo(() => {
    let received = 0
    let rejection = 0
    let multiDispatch = 0
    let rejectionOnly = 0
    let outwardQty = 0
    let outwardValue = 0 as Paise
    for (const r of dateFiltered) {
      received += r.received
      const billed = r.children.filter((c) => c.dispatch.kind === 'billed').length
      if (billed > 1) multiDispatch += 1
      const hasChildren = r.children.length > 0
      const onlyRej = hasChildren && r.children.every((c) => c.dispatch.kind === 'rejection')
      if (onlyRej) rejectionOnly += 1
      for (const c of r.children) {
        rejection += c.dispatch.mcRejQty + c.dispatch.mfQty
        if (c.dispatch.kind === 'billed') {
          outwardQty += c.dispatch.okQty
          const rate = c.dispatch.rateSnapshotPaise
          if (rate != null) outwardValue = addP(outwardValue, mulQty(rate, c.dispatch.okQty))
        }
      }
    }
    return { challans: dateFiltered.length, multiDispatch, received, rejection, rejectionOnly, outwardQty, outwardValue }
  }, [dateFiltered])

  const partOptions = useMemo(() => {
    const set = new Set<string>()
    for (const r of rows) set.add(r.partNo)
    return [...set].sort()
  }, [rows])

  const shown = useMemo(
    () =>
      dateFiltered.filter((r) => {
        if (partFilter !== 'all' && r.partNo !== partFilter) return false
        if (q) {
          const hay = `${r.inward.challanNo} ${r.partNo} ${r.inward.poNo ?? ''} ${r.inward.batchHeatNo}`.toLowerCase()
          if (!hay.includes(q)) return false
        }
        if (tab === 'open') return r.balance !== 'Dispatched'
        if (tab === 'done') return r.balance === 'Dispatched'
        return true
      }),
    [dateFiltered, tab, partFilter, q]
  )
  // Server-driven table in API mode (paging/searching hits GET /inward with the
  // tab/part/date/search as query params); client-side over `shown` in local mode.
  // KPIs stay computed from the hydrated store above. Bump `refreshKey` after a
  // write so the fetched page reflects the change.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)

  // Attachment (FR-IN09) — upload a scanned challan/invoice to an inward (server-stored).
  const fileRef = useRef<HTMLInputElement>(null)
  const [attachId, setAttachId] = useState<Id | null>(null)
  const triggerAttach = (id: Id) => { setAttachId(id); fileRef.current?.click() }
  async function onFilePicked(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file || !attachId) return
    if (file.size > 10 * 1024 * 1024) { toastCommandError(new Error('File too large (max 10 MB)')); return }
    try {
      const dataBase64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader()
        r.onload = () => resolve(String(r.result).split(',')[1] ?? '')
        r.onerror = () => reject(new Error('Could not read the file'))
        r.readAsDataURL(file)
      })
      await inwardApi.uploadAttachment(attachId, { filename: file.name, mime: file.type || 'application/octet-stream', dataBase64 })
      toastCommandSuccess(`Attached ${file.name}`, [])
      bumpRefresh()
    } catch (err) { toastCommandError(err) }
  }
  async function viewAttachment(id: Id) {
    try { window.open(await inwardApi.attachmentUrl(id), '_blank', 'noopener') }
    catch (err) { toastCommandError(err) }
  }
  const paged = usePagedSource({
    localRows: shown,
    endpoint: '/inward',
    extraParams: {
      from: from || undefined,
      to: to || undefined,
      partNo: partFilter !== 'all' ? partFilter : undefined,
      balance: tab === 'all' ? undefined : tab,
      search: q || undefined,
    },
    pageSize: 25,
    refreshKey,
  })

  function toggle(id: Id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onInwardValid(values: InwardFormValues) {
    try {
      const res = runSaveInward(inwardValuesToInput(values, inwardModal?.inward?.id))
      toastCommandSuccess(inwardModal?.inward ? 'Inward updated' : 'Inward saved', res.cascade)
      setInwardModal(null)
    } catch (e) {
      toastCommandError(e)
    }
  }

  function confirmDelete() {
    if (!deleting) return
    try {
      const res = deleting.kind === 'inward' ? runDeleteInward(deleting.id) : runDeleteDispatch(deleting.id)
      toastCommandSuccess('Deleted', res.cascade)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleting(null)
    }
  }

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="flex flex-wrap items-start gap-3">
        {!embedded ? (
          <div className="min-w-0">
            <h1 className="text-xl font-bold tracking-tight">Inward / Outward register</h1>
            <p className="mt-0.5 text-[13px] text-muted-fg">
              One inward challan &rarr; many outward dispatches &rarr; payment.
            </p>
          </div>
        ) : null}
        <div className="ml-auto flex items-center gap-2">
          {canImport ? (
            <Button variant="secondary" leftIcon={<FileSpreadsheet size={15} />} onClick={() => setImportOpen(true)}>
              Import
            </Button>
          ) : null}
          {canInwardCreate ? (
            <Button leftIcon={<Plus size={15} />} onClick={() => setInwardModal({ inward: null })}>
              Inward entry
            </Button>
          ) : null}
        </div>
      </div>

      {/* Import facility — the full MIO wizard, surfaced in a drawer (mock §4). */}
      {canImport ? (
        <Drawer
          open={importOpen}
          onClose={() => setImportOpen(false)}
          size="xl"
          title="Import MIO workbook"
          description="Map columns, preview, and commit one undoable import."
          defaultMaximized
        >
          <ImportWizard embedded onClose={() => setImportOpen(false)} />
        </Drawer>
      ) : null}

      {/* KPIs */}
      <KpiGrid>
        <Kpi tone="blue" label="Inward challans" value={intFmt(kpis.challans)} sub="groups on register" />
        <Kpi tone="amber" label="Received qty" value={intFmt(kpis.received)} sub="pcs inward" />
        <Kpi tone="green" label="Total Outward Qty" value={intFmt(kpis.outwardQty)} sub="OK pcs dispatched" />
        <Kpi tone="green" label="Total Outward Value" value={formatINRCompact(kpis.outwardValue)} sub="dispatched (ex-GST)" />
        <Kpi tone="purple" label="Multi-dispatch" value={intFmt(kpis.multiDispatch)} sub="1 challan &rarr; many bills" />
        <Kpi tone="red" label="Rejection (MR+MF)" value={intFmt(kpis.rejection)} sub="stock &minus;, no bill" />
      </KpiGrid>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2.5">
        {/* On-page search — the Topbar search is hidden below md, so the register needs its
            own input for shop-floor tablet/mobile use. Writes ?q which this page consumes. */}
        <div className="relative w-full sm:w-56">
          <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-faint" aria-hidden />
          <input
            type="search"
            value={qRaw}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search challan / part / heat…"
            aria-label="Search register"
            className="input h-9 w-full pl-8"
          />
        </div>
        <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Filter receipts" />
        <SearchableDropdown
          aria-label="Filter by part"
          value={partFilter}
          onChange={setPartFilter}
          options={[{ value: 'all', label: 'Part: All' }, ...partOptions.map((p) => ({ value: p, label: p }))]}
          className="w-44 text-xs"
        />
        <div className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          <span>From</span>
          <input type="date" className="input h-9 w-[140px]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Challans from date" />
          <span>To</span>
          <input type="date" className="input h-9 w-[140px]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Challans to date" />
          {from || to ? <button type="button" className="btn btn-ghost h-9 px-2" onClick={() => { setFrom(''); setTo('') }}>Clear</button> : null}
        </div>
        {kpis.rejectionOnly > 0 ? (
          <Chip tone="warn" onClick={() => setTab('open')}>
            ⚠ {kpis.rejectionOnly} rejection-only row{kpis.rejectionOnly === 1 ? '' : 's'}
          </Chip>
        ) : null}
      </div>

      {/* Register table */}
      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={ArrowDownToLine}
            title={rows.length === 0 ? 'No challans yet' : 'Nothing matches this filter'}
            description={
              rows.length === 0
                ? canInwardCreate
                  ? 'Record an inward challan to begin the register.'
                  : 'Nothing in your scope yet.'
                : 'Try a different tab or part.'
            }
            action={
              rows.length === 0 && canInwardCreate ? (
                <Button leftIcon={<Plus size={15} />} onClick={() => setInwardModal({ inward: null })}>
                  Inward entry
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold" style={{ width: 168 }}>Inward challan</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">PO no</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Batch / heat</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">RM rate</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Received</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Billed</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((row) => (
                <RegisterRow
                  key={row.inward.id}
                  row={row}
                  open={expanded.has(row.inward.id)}
                  onToggle={() => toggle(row.inward.id)}
                  canDispatchCreate={canDispatchCreate}
                  canDispatchEdit={canDispatchEdit}
                  canDispatchDelete={canDispatchDelete}
                  canInwardEdit={canInwardEdit}
                  canInwardDelete={canInwardDelete}
                  onOpenOutward={onOpenOutward ? () => onOpenOutward(row.inward.id) : undefined}
                  onAddDispatch={() => setDispatchModal({ inward: row.inward, dispatch: null })}
                  onEditDispatch={(d) => setDispatchModal({ inward: row.inward, dispatch: d })}
                  onEditInward={() => setInwardModal({ inward: row.inward })}
                  onDeleteInward={() => setDeleting({ kind: 'inward', id: row.inward.id, label: row.inward.challanNo })}
                  onDeleteDispatch={(d) =>
                    setDeleting({ kind: 'dispatch', id: d.id, label: `${d.billNo ?? 'dispatch'} on ${row.inward.challanNo}` })
                  }
                  onAttach={apiEnabled() && canInwardEdit ? () => triggerAttach(row.inward.id) : undefined}
                  onView={apiEnabled() && row.inward.attachmentName ? () => viewAttachment(row.inward.id) : undefined}
                />
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      <div className="flex flex-wrap gap-x-6 gap-y-1 text-[11px] text-faint">
        <span><b className="text-muted-fg">Inward</b> = challan, heat, RM rate, received</span>
        <span><b className="text-muted-fg">Outward</b> = bill, OK / MR / MF, rate, IGST</span>
        <span><b className="text-muted-fg">Payment</b> = customer invoice</span>
        <span>Click the challan to expand dispatches · <b className="text-muted-fg">double-click a row to create an invoice</b></span>
      </div>

      <input ref={fileRef} type="file" className="hidden" accept="image/*,application/pdf" onChange={onFilePicked} aria-hidden />

      {inwardModal !== null ? (
        <RecordFormModal
          key={inwardModal.inward?.id ?? '__new__'}
          title={inwardModal.inward ? 'Edit inward challan' : 'New inward challan'}
          fields={inwardFields}
          schema={inwardSchema}
          defaultValues={inwardModal.inward ? inwardToValues(inwardModal.inward) : inwardDefaults()}
          submitLabel={inwardModal.inward ? 'Save changes' : 'Save inward'}
          beforeFields={!inwardModal.inward ? (
            <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <span className="text-muted-fg">Part not in the catalogue?</span>
              <a href="/materials" target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-medium text-primary hover:underline">
                <Plus size={13} /> Add new catalogue part
              </a>
            </div>
          ) : null}
          onValid={(v) => onInwardValid(v as InwardFormValues)}
          deriveOnChange={(changed, values, setValue) => {
            // Auto-fill RM rate / RM wt / finish wt from the selected part (editable).
            if (changed !== 'partId' || !values.partId) return
            const part = getById(useStore.getState().masters.parts, values.partId as string)
            if (!part) return
            if (part.rmRatePaise != null) setValue('rmRate', fromPaise(part.rmRatePaise))
            if (part.rmWtMg != null) setValue('rmWtG', part.rmWtMg / 1000)
            setValue('finishWtG', part.finishWtMg / 1000)
            if (part.defaultPoNo) setValue('poNo', part.defaultPoNo)
          }}
          onClose={() => { setInwardModal(null); bumpRefresh() }}
        />
      ) : null}

      {dispatchModal !== null ? (
        <DispatchForm
          key={dispatchModal.dispatch?.id ?? '__new__'}
          inward={dispatchModal.inward}
          existing={dispatchModal.dispatch}
          partNo={rows.find((r) => r.inward.id === dispatchModal.inward.id)?.partNo ?? ''}
          onClose={() => { setDispatchModal(null); bumpRefresh() }}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={confirmDelete}
        tone="danger"
        title={deleting?.kind === 'inward' ? 'Delete challan?' : 'Delete dispatch?'}
        confirmLabel="Delete"
        message={deleting ? `“${deleting.label}” will be removed. This can be undone from the toolbar.` : ''}
      />
    </div>
  )
}

const STATUS: Record<InwardRow['balance'], { tone: 'primary' | 'warning' | 'success'; text: (r: InwardRow) => string }> = {
  'In-house': { tone: 'primary', text: () => 'In-house' },
  Partial: { tone: 'warning', text: (r) => `Partial · ${intFmt(r.available)} open` },
  Dispatched: { tone: 'success', text: () => 'Dispatched' },
}

function RegisterRow({
  row,
  open,
  onToggle,
  canDispatchCreate,
  canDispatchEdit,
  canDispatchDelete,
  canInwardEdit,
  canInwardDelete,
  onOpenOutward,
  onAddDispatch,
  onEditDispatch,
  onEditInward,
  onDeleteInward,
  onDeleteDispatch,
  onAttach,
  onView,
}: {
  row: InwardRow
  open: boolean
  onToggle: () => void
  canDispatchCreate: boolean
  canDispatchEdit: boolean
  canDispatchDelete: boolean
  canInwardEdit: boolean
  canInwardDelete: boolean
  onOpenOutward?: () => void
  onAddDispatch: () => void
  onEditDispatch: (d: Dispatch) => void
  onEditInward: () => void
  onDeleteInward: () => void
  onDeleteDispatch: (d: Dispatch) => void
  onAttach?: () => void
  onView?: () => void
}) {
  const hasChildren = row.children.length > 0
  const billedQty = row.children.reduce((a, c) => a + c.dispatch.okQty, 0)
  const rejQty = row.children.reduce((a, c) => a + c.dispatch.mcRejQty + c.dispatch.mfQty, 0)
  const status = STATUS[row.balance]
  const subId = `dispatches-${row.inward.id}`

  // Row actions collapsed into the trailing "⋮" menu (only the ones that apply).
  const inwardActions: ActionMenuItem[] = [
    ...(canDispatchCreate && onOpenOutward && row.available > 0 ? [{ key: 'outward', label: 'Create Invoice', icon: <ArrowUpFromLine />, onClick: onOpenOutward }] : []),
    ...(canDispatchCreate && row.available > 0 ? [{ key: 'dispatch', label: 'Add Dispatch', icon: <Truck />, onClick: onAddDispatch }] : []),
    ...(onView ? [{ key: 'view', label: 'View document', icon: <FileText />, onClick: onView }] : []),
    ...(onAttach ? [{ key: 'attach', label: row.inward.attachmentName ? 'Replace document' : 'Attach document', icon: <Paperclip />, onClick: onAttach }] : []),
    ...(canInwardEdit ? [{ key: 'edit', label: 'Edit challan', icon: <Pencil />, onClick: onEditInward }] : []),
    ...(canInwardDelete ? [{ key: 'delete', label: 'Delete challan', icon: <Trash2 />, onClick: onDeleteInward, danger: true }] : []),
  ]

  return (
    <>
      <tr
        className="border-b border-border/60 hover:bg-muted/40"
        onDoubleClick={onOpenOutward && row.available > 0 ? onOpenOutward : undefined}
        title={onOpenOutward && row.available > 0 ? 'Double-click to create an invoice from this challan' : undefined}
      >
        <td className="px-3 py-2.5 font-medium">
          {hasChildren ? (
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={open}
              aria-controls={subId}
              aria-label={`${open ? 'Collapse' : 'Expand'} dispatches for challan ${row.inward.challanNo}`}
              className="-mx-1 inline-flex items-center gap-1.5 rounded px-1 py-0.5 text-left transition-colors hover:bg-primary/10 focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="text-faint">{open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}</span>
              <span className="mono">{row.inward.challanNo}</span>
            </button>
          ) : (
            <span className="inline-flex items-center gap-1.5">
              <span className="w-[13px] text-faint">·</span>
              <span className="mono">{row.inward.challanNo}</span>
            </span>
          )}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone="accent">{row.partNo}</Badge>
          {row.inward.remarks ? <span className="ml-1.5 text-[10px] text-warning">{row.inward.remarks}</span> : null}
        </td>
        <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(row.inward.challanDate)}</td>
        <td className="px-3 py-2.5 mono text-[11px] text-faint">{row.inward.poNo ?? '—'}</td>
        <td className="px-3 py-2.5 mono text-[11px] text-faint">{row.inward.batchHeatNo}</td>
        <td className="px-3 py-2.5 text-right mono text-muted-fg">
          {row.inward.rmRatePaise != null ? formatINR(row.inward.rmRatePaise) : '—'}
        </td>
        <td className="px-3 py-2.5 text-right mono font-bold">{intFmt(row.received)}</td>
        <td className="px-3 py-2.5 text-right mono">
          {intFmt(billedQty)}
          {rejQty ? <span className="ml-1 font-semibold text-danger">+{intFmt(rejQty)} rej</span> : null}
        </td>
        <td className="px-3 py-2.5">
          <Badge tone={status.tone}>{status.text(row)}</Badge>
        </td>
        <td className="px-3 py-2.5">
          <div className="flex items-center justify-end">
            <ActionMenu label={`Actions for challan ${row.inward.challanNo}`} items={inwardActions} />
          </div>
        </td>
      </tr>

      {open && hasChildren ? (
        <tr className="bg-muted/60">
          <td colSpan={10} className="px-0 py-0">
            <div id={subId} className="px-3 py-3 pl-9">
              <div className="mb-2 text-[11px] font-semibold text-muted-fg">
                ↳ Outward dispatches &amp; payment for {row.inward.challanNo} — {row.children.length} line
                {row.children.length === 1 ? '' : 's'}
              </div>
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="text-left text-[10.5px] uppercase tracking-wide text-faint">
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Bill / DC</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Date</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">OK</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">MR</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">MF</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Total</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Rate</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">IGST</th>
                    <th scope="col" className="py-1.5 pr-3 text-right font-semibold">Grand</th>
                    <th scope="col" className="py-1.5 pr-3 font-semibold">Cust inv</th>
                    <th scope="col" className="py-1.5" />
                  </tr>
                </thead>
                <tbody>
                  {row.children.map((c) => (
                    <DispatchSubRow
                      key={c.dispatch.id}
                      child={c}
                      canEdit={canDispatchEdit}
                      canDelete={canDispatchDelete}
                      onEdit={() => onEditDispatch(c.dispatch)}
                      onDelete={() => onDeleteDispatch(c.dispatch)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      ) : null}
    </>
  )
}

function DispatchSubRow({
  child,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
}: {
  child: DispatchChild
  canEdit: boolean
  canDelete: boolean
  onEdit: () => void
  onDelete: () => void
}) {
  const d = child.dispatch
  const total = d.okQty + d.mcRejQty + d.mfQty
  const isRejection = d.kind === 'rejection'
  const rate = d.rateSnapshotPaise
  const sub: Paise | undefined = rate != null ? mulQty(rate, d.okQty) : undefined
  const igst: Paise | undefined = sub != null && d.gstPctSnapshot != null ? pctOfPaise(sub, d.gstPctSnapshot) : undefined
  const grand: Paise | undefined = sub != null ? addP(sub, igst ?? (0 as Paise)) : undefined

  const dispatchActions: ActionMenuItem[] = [
    ...(canEdit ? [{ key: 'edit', label: 'Edit dispatch', icon: <Pencil />, onClick: onEdit }] : []),
    ...(canDelete ? [{ key: 'delete', label: 'Delete dispatch', icon: <Trash2 />, onClick: onDelete, danger: true }] : []),
  ]

  return (
    <tr className="border-t border-border/60">
      <td className="py-1.5 pr-3 mono">{d.billNo ?? '—'}</td>
      <td className="py-1.5 pr-3 mono text-muted-fg">{d.billDate ? formatDMY(d.billDate) : d.dispatchDate ? formatDMY(d.dispatchDate) : '—'}</td>
      <td className="py-1.5 pr-3 text-right mono">{d.okQty ? intFmt(d.okQty) : '–'}</td>
      <td className={`py-1.5 pr-3 text-right mono ${d.mcRejQty ? 'font-semibold text-danger' : ''}`}>{d.mcRejQty ? intFmt(d.mcRejQty) : '–'}</td>
      <td className={`py-1.5 pr-3 text-right mono ${d.mfQty ? 'font-semibold text-danger' : ''}`}>{d.mfQty ? intFmt(d.mfQty) : '–'}</td>
      <td className="py-1.5 pr-3 text-right mono font-semibold">{intFmt(total)}</td>
      {isRejection ? (
        <td colSpan={3} className="py-1.5 pr-3 font-medium text-danger">rejection · stock −, no bill</td>
      ) : (
        <>
          <td className="py-1.5 pr-3 text-right mono">{rate != null ? formatINR(rate) : '—'}</td>
          <td className="py-1.5 pr-3 text-right mono text-muted-fg">{igst != null ? formatINRSymbol(igst) : '—'}</td>
          <td className="py-1.5 pr-3 text-right mono font-semibold">{grand != null ? formatINRSymbol(grand) : '—'}</td>
        </>
      )}
      <td className="py-1.5 pr-3 mono text-muted-fg">{d.custInvoiceNo ?? (child.invoiceBillNo ? `bill ${child.invoiceBillNo}` : '—')}</td>
      <td className="py-1.5">
        <div className="flex items-center justify-end">
          <ActionMenu label={`Actions for dispatch ${d.billNo ?? ''}`} items={dispatchActions} />
        </div>
      </td>
    </tr>
  )
}
