import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ReceiptText, FileDown, Ban, FileSignature, Eye, Printer, IndianRupee, Pencil, Trash2, Plus } from 'lucide-react'
import { formatINR, formatINRSymbol, formatINRCompact, fromPaise, toPaise, type Paise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import type { Id, Invoice, IssuerKind, PaymentMode } from '@/types/domain'
import { useStore } from '@/store'
import { getById, values } from '@/store/normalized'
import { runFinalizeInvoice, runEditDraftInvoice, runVoidInvoice, runRecordPayment } from '@/store/billingCommands'
import { runSaveDispatch, runDeleteDispatch } from '@/store/registerCommands'
import {
  selectInvoiceRows,
  selectInvoiceLines,
  computeInvoice,
  deriveTaxKind,
  selectInvoiceDocModel,
  packingLineLabel,
  packingTotal,
  type InvoiceRow,
  type InvoiceDocModel,
} from '@/selectors/invoiceCompute'
import type { PaymentStatus } from '@/selectors/billing'
import { selectOpenInwardRows, latestProductionRatePaise } from '@/selectors/register'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { ActionMenu, Badge, Button, Card, Drawer, EmptyState, Kpi, KpiGrid, Modal, SearchableDropdown, TablePager, Tabs, type ActionMenuItem, type BadgeTone } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'
import { toast } from 'sonner'

type StatusFilter = 'all' | 'draft' | 'sent' | 'paid' | 'overdue'
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
] as const

const PAYMENT_MODES: PaymentMode[] = ['rtgs', 'neft', 'cheque', 'upi', 'cash', 'bank']

const STATUS_TONE: Record<PaymentStatus, BadgeTone> = {
  draft: 'muted',
  unpaid: 'primary',
  partial: 'warning',
  overdue: 'danger',
  paid: 'success',
  void: 'muted',
}

export default function Billing() {
  const can = useCan()
  const rows = useStore(useShallow(selectInvoiceRows))
  const [tab, setTab] = useState<StatusFilter>('all')
  const [builder, setBuilder] = useState<Invoice | null>(null)
  const [preview, setPreview] = useState<Id | null>(null)
  const [paying, setPaying] = useState<InvoiceRow | null>(null)
  const [selected, setSelected] = useState<Set<Id>>(new Set())
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')

  const canEdit = can('billing', 'edit')

  // MTD-style roll-up for the KPI strip (spec §7), from the snapshotted totals.
  const kpis = useMemo(() => {
    let taxable = 0, gst = 0, pending = 0, issued = 0, draft = 0, overdue = 0
    for (const r of rows) {
      if (r.invoice.lifecycle === 'draft') { draft++; continue }
      if (r.invoice.lifecycle === 'void') continue
      issued++
      const t = r.invoice.totals
      if (t) { taxable += t.assessable; gst += t.cgst + t.sgst + t.igst }
      pending += r.outstanding
      if (r.status === 'overdue') overdue++
    }
    return { taxable, gst, pending, issued, draft, overdue }
  }, [rows])

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        const d = r.invoice.invoiceDate
        if (from && (!d || d < from)) return false
        if (to && (!d || d > to)) return false
        if (tab === 'draft') return r.invoice.lifecycle === 'draft'
        if (tab === 'sent') return r.invoice.lifecycle === 'sent'
        if (tab === 'paid') return r.status === 'paid'
        if (tab === 'overdue') return r.status === 'overdue'
        return true
      }),
    [rows, tab, from, to]
  )
  // Server-driven in API mode: tab → lifecycle/status param, date → from/to, search →
  // server search. Local mode pages `shown` client-side. A write bumps refreshKey.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)
  const paged = usePagedSource({
    localRows: shown,
    endpoint: '/invoices',
    searchText: (r) => `${r.invoice.billNo ?? ''} ${r.customerName ?? ''}`,
    extraParams: {
      from: from || undefined,
      to: to || undefined,
      lifecycle: tab === 'draft' ? 'draft' : tab === 'sent' ? 'sent' : undefined,
      status: tab === 'paid' ? 'paid' : tab === 'overdue' ? 'overdue' : undefined,
    },
    pageSize: 25,
    refreshKey,
  })

  const selectableSent = shown.filter((r) => r.invoice.lifecycle === 'sent')

  async function downloadPdf(id: Id) {
    const model = selectInvoiceDocModel(useStore.getState(), id)
    if (!model) return
    try {
      const { downloadInvoicePdf } = await import('@/lib/invoicePdf')
      await downloadInvoicePdf(model)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Could not render the PDF')
    }
  }

  async function bulkPdf() {
    const ids = [...selected]
    toast.message(`Generating ${ids.length} PDF${ids.length === 1 ? '' : 's'}…`)
    for (const id of ids) await downloadPdf(id)
    setSelected(new Set())
  }

  function toggleSel(id: Id) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function onVoid(id: Id) {
    try {
      const res = runVoidInvoice(id)
      toastCommandSuccess('Invoice voided', res.cascade)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Billing &amp; Invoice</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Auto-generated GST tax invoices per Bill No — finalize drafts, issue, preview and export.</p>
        </div>
      </div>

      <KpiGrid>
        <Kpi tone="blue" label="Invoices Issued" value={kpis.issued.toLocaleString('en-IN')} sub={`${kpis.draft} draft`} />
        <Kpi tone="green" label="Taxable Value" value={formatINRCompact(kpis.taxable as Paise)} sub="assessable" />
        <Kpi tone="purple" label="GST Collected" value={formatINRCompact(kpis.gst as Paise)} sub="CGST + SGST + IGST" />
        <Kpi tone="amber" label="Pending Collection" value={formatINRCompact(kpis.pending as Paise)} sub={kpis.overdue ? `${kpis.overdue} overdue` : 'to collect'} />
      </KpiGrid>

      <div className="flex flex-wrap items-center gap-2.5">
        <input
          className="input h-9 w-56"
          placeholder="Search…"
          aria-label="Search"
          value={paged.search}
          onChange={(e) => paged.setSearch(e.target.value)}
        />
        <Tabs items={FILTERS} value={tab} onChange={setTab} ariaLabel="Filter invoices" />
        <div className="flex items-center gap-1.5 text-[12px] text-muted-fg">
          <span>From</span>
          <input type="date" className="input h-9 w-[140px]" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} aria-label="Invoices from date" />
          <span>To</span>
          <input type="date" className="input h-9 w-[140px]" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} aria-label="Invoices to date" />
          {from || to ? <button type="button" className="btn btn-ghost h-9 px-2" onClick={() => { setFrom(''); setTo('') }}>Clear</button> : null}
        </div>
        {selected.size > 0 ? (
          <Button variant="secondary" leftIcon={<FileDown size={15} />} onClick={bulkPdf}>
            Download {selected.size} PDF{selected.size === 1 ? '' : 's'}
          </Button>
        ) : null}
      </div>

      {shown.length === 0 ? (
        <Card>
          <EmptyState
            icon={ReceiptText}
            title="No invoices"
            description="Draft invoices are created automatically when you record a billed dispatch."
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="w-8 px-3 py-2.5" />
                <th scope="col" className="px-3 py-2.5 font-semibold">Bill no</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Lines</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Grand</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Outstanding</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <BillingRow
                  key={r.invoice.id}
                  row={r}
                  canEdit={canEdit}
                  checked={selected.has(r.invoice.id)}
                  onCheck={() => toggleSel(r.invoice.id)}
                  onPreview={() => setPreview(r.invoice.id)}
                  onFinalize={() => setBuilder(r.invoice)}
                  onPay={() => setPaying(r)}
                  onPdf={() => downloadPdf(r.invoice.id)}
                  onVoid={() => onVoid(r.invoice.id)}
                />
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      {selectableSent.length > 0 ? (
        <p className="text-[11px] text-faint">Tick issued invoices to bulk-download their PDFs.</p>
      ) : null}

      {builder ? (
        <InvoiceBuilder
          key={builder.id}
          invoice={builder}
          onClose={() => setBuilder(null)}
          onDone={() => { setBuilder(null); bumpRefresh() }}
        />
      ) : null}

      {preview ? (
        <InvoicePreview
          key={preview}
          invoiceId={preview}
          onClose={() => setPreview(null)}
          onPdf={() => downloadPdf(preview)}
        />
      ) : null}

      {paying ? (
        <PaymentModal
          key={paying.invoice.id}
          billNo={paying.invoice.billNo}
          customer={paying.customerName}
          invoiceId={paying.invoice.id}
          outstanding={paying.outstanding}
          onClose={() => setPaying(null)}
          onDone={() => { setPaying(null); bumpRefresh() }}
        />
      ) : null}
    </div>
  )
}

function BillingRow({
  row,
  canEdit,
  checked,
  onCheck,
  onPreview,
  onFinalize,
  onPay,
  onPdf,
  onVoid,
}: {
  row: InvoiceRow
  canEdit: boolean
  checked: boolean
  onCheck: () => void
  onPreview: () => void
  onFinalize: () => void
  onPay: () => void
  onPdf: () => void
  onVoid: () => void
}) {
  const inv = row.invoice
  const isDraft = inv.lifecycle === 'draft'
  const isSent = inv.lifecycle === 'sent'
  // A sent invoice never reads "draft" (its payment status is 'draft' only when
  // totals weren't snapshotted — a legacy/seed artifact); show it as unpaid.
  const displayStatus: PaymentStatus = inv.lifecycle === 'void' ? 'void' : isSent && row.status === 'draft' ? 'unpaid' : row.status
  const tone: BadgeTone = STATUS_TONE[displayStatus]
  return (
    <tr className="border-b border-border/60 hover:bg-muted/40">
      <td className="px-3 py-2.5">
        {isSent ? (
          <input type="checkbox" checked={checked} onChange={onCheck} aria-label={`Select bill ${inv.billNo}`} />
        ) : null}
      </td>
      <td className="px-3 py-2.5 mono font-medium">{inv.billNo}</td>
      <td className="px-3 py-2.5">{row.customerName}</td>
      <td className="px-3 py-2.5 mono text-muted-fg">{inv.invoiceDate ? formatDMY(inv.invoiceDate) : '—'}</td>
      <td className="px-3 py-2.5 text-right mono">{row.lineCount}</td>
      <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(row.grand)}</td>
      <td className="px-3 py-2.5 text-right mono">{row.status === 'paid' || row.status === 'void' ? '—' : formatINRSymbol(row.outstanding)}</td>
      <td className="px-3 py-2.5">
        <Badge tone={tone} className="capitalize">
          {displayStatus}
        </Badge>
      </td>
      <td className="px-3 py-2.5">
        <div className="flex items-center justify-end">
          <ActionMenu
            label={`Actions for invoice ${inv.billNo}`}
            items={[
              { key: 'preview', label: 'Preview invoice', icon: <Eye />, onClick: onPreview },
              ...(isDraft && canEdit ? [{ key: 'edit', label: 'Edit draft', icon: <Pencil />, onClick: onFinalize }] : []),
              ...(isDraft && canEdit ? [{ key: 'finalize', label: 'Finalize / issue', icon: <FileSignature />, onClick: onFinalize }] : []),
              ...(isSent && canEdit && row.outstanding > 0 ? [{ key: 'pay', label: 'Record payment', icon: <IndianRupee />, onClick: onPay }] : []),
              ...(isSent ? [{ key: 'pdf', label: 'Download PDF', icon: <FileDown />, onClick: onPdf }] : []),
              ...(isSent && canEdit ? [{ key: 'void', label: 'Void invoice', icon: <Ban />, onClick: onVoid, danger: true }] : []),
            ] as ActionMenuItem[]}
          />
        </div>
      </td>
    </tr>
  )
}

/** Record a receipt against ONE invoice (the Invoice-module payment form). */
function PaymentModal({ billNo, customer, invoiceId, outstanding, onClose, onDone }: { billNo: string; customer: string; invoiceId: Id; outstanding: Paise; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<PaymentMode>('rtgs')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayISO())
  const [amount, setAmount] = useState(String(fromPaise(outstanding)))
  const [submitting, setSubmitting] = useState(false)
  const amountPaise = (amount ? toPaise(Number(amount)) : 0) as Paise
  const over = amountPaise > outstanding

  function onSave() {
    setSubmitting(true)
    try {
      const res = runRecordPayment({ mode, ref: ref.trim(), date, amountPaise, allocations: [{ invoiceId, amountPaise }] })
      toastCommandSuccess('Payment recorded', res.cascade)
      onDone()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={`Record payment — ${billNo}`}
      description={`${customer} · outstanding ${formatINRSymbol(outstanding)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={amountPaise <= 0 || over}>Receive {formatINRSymbol(amountPaise)}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Amount (₹)</span>
          <div className="flex items-center gap-2">
            <input type="number" min={0} step="0.01" className="input h-9" value={amount} onChange={(e) => setAmount(e.target.value)} aria-label="Payment amount" />
            <button type="button" className="shrink-0 text-[11px] text-primary hover:underline" onClick={() => setAmount(String(fromPaise(outstanding)))}>full</button>
          </div>
          {over ? <span className="text-[11px] text-danger">Exceeds outstanding {formatINRSymbol(outstanding)}</span> : null}
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Date</span>
          <input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Mode</span>
          <SearchableDropdown aria-label="Payment mode" value={mode} onChange={(v) => setMode(v as PaymentMode)} options={PAYMENT_MODES.map((m) => ({ value: m, label: m.toUpperCase() }))} />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-[11.5px] font-medium text-muted-fg">Ref / UTR / cheque no</span>
          <input className="input h-9" value={ref} onChange={(e) => setRef(e.target.value)} />
        </label>
      </div>
    </Drawer>
  )
}

function InvoiceBuilder({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const customers = useStore(useShallow((st) => values(st.masters.customers).filter((c) => c.active)))
  const rmVendors = useStore(useShallow((st) => values(st.masters.vendors).filter((v) => v.active && v.type === 'rm' && v.gstin)))
  // Reactive: reflects undo/redo or master edits while the modal is open.
  const lines = useStore(useShallow((s) => selectInvoiceLines(s, invoice)))
  const canEdit = useCan()('dispatch', 'create') // editing a line edits its dispatch

  const [customerId, setCustomerId] = useState(invoice.customerId ?? '')
  const [issuerKind, setIssuerKind] = useState<IssuerKind>(invoice.issuerKind)
  const [issuerVendorId, setIssuerVendorId] = useState(invoice.issuerKind === 'supplier' ? invoice.issuerId : '')
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate)
  const [ewayBillNo, setEwayBillNo] = useState(invoice.ewayBillNo ?? '')
  const [vehicleNo, setVehicleNo] = useState(invoice.vehicleNo ?? '')
  const [transporter, setTransporter] = useState(invoice.transporter ?? '')
  const [dispatchedThrough, setDispatchedThrough] = useState(invoice.dispatchedThrough ?? '')
  const [destination, setDestination] = useState(invoice.destination ?? '')
  const dispatchFields = { ewayBillNo, vehicleNo, transporter, dispatchedThrough, destination }
  const [submitting, setSubmitting] = useState(false)
  // Local input buffers for editable line qty/rate; committed to the dispatch on blur
  // (a line IS a billed dispatch, so editing it edits stock — totals then recompute live).
  const [qtyBuf, setQtyBuf] = useState<Record<string, string>>({})
  const [rateBuf, setRateBuf] = useState<Record<string, string>>({})
  const clearBuf = (id: string) => {
    setQtyBuf((p) => { const n = { ...p }; delete n[id]; return n })
    setRateBuf((p) => { const n = { ...p }; delete n[id]; return n })
  }

  function commitLine(l: { dispatchId: Id; qty: number; ratePaise: Paise }) {
    const d = getById(useStore.getState().inventory.dispatches, l.dispatchId)
    if (!d) return
    const qty = qtyBuf[l.dispatchId] != null ? Math.round(Number(qtyBuf[l.dispatchId])) : l.qty
    const rate = rateBuf[l.dispatchId] != null ? Number(rateBuf[l.dispatchId]) : fromPaise(l.ratePaise)
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(rate) || rate <= 0) { clearBuf(l.dispatchId); return }
    if (qty === d.okQty && toPaise(rate) === d.rateSnapshotPaise) { clearBuf(l.dispatchId); return }
    try {
      runSaveDispatch({
        id: d.id, inwardId: d.inwardId, kind: 'billed', okQty: qty, mcRejQty: d.mcRejQty, mfQty: d.mfQty,
        billNo: d.billNo, billDate: d.billDate, dispatchDate: d.dispatchDate, ratePaise: toPaise(rate),
        custInvoiceNo: d.custInvoiceNo, custInvoiceDate: d.custInvoiceDate, remarks: d.remarks,
      })
    } catch (e) { toastCommandError(e) }
    clearBuf(l.dispatchId)
  }
  function removeLine(dispatchId: Id) {
    try { runDeleteDispatch(dispatchId) } catch (e) { toastCommandError(e) }
  }

  // Add another part / challan to this invoice: open inward challans in the SAME unit
  // (a new billed dispatch with this bill's number links onto the draft via relinkInvoice).
  const [addChallanId, setAddChallanId] = useState('')
  const [addQty, setAddQty] = useState('')
  const [addRate, setAddRate] = useState('')
  const openChallans = useStore(useShallow((s) => selectOpenInwardRows(s).filter((r) => r.inward.unitId === invoice.unitId && r.available > 0)))
  function pickAddChallan(id: string) {
    setAddChallanId(id)
    const r = openChallans.find((x) => x.inward.id === id)
    const rp = r ? latestProductionRatePaise(useStore.getState(), r.inward.partId) : undefined
    setAddQty(r ? String(r.available) : '')
    setAddRate(rp != null ? String(fromPaise(rp)) : '')
  }
  function addLine() {
    const r = openChallans.find((x) => x.inward.id === addChallanId)
    if (!r) return
    const qty = Math.round(Number(addQty))
    const rate = Number(addRate)
    if (!(qty > 0)) { toastCommandError(new Error('Enter a quantity for the new line')); return }
    if (!(rate > 0)) { toastCommandError(new Error('Enter a rate for the new line')); return }
    try {
      runSaveDispatch({
        inwardId: r.inward.id, kind: 'billed', okQty: qty, mcRejQty: 0, mfQty: 0,
        billNo: invoice.billNo, billDate: invoiceDate || undefined, dispatchDate: invoiceDate || undefined,
        ratePaise: toPaise(rate),
      })
      setAddChallanId(''); setAddQty(''); setAddRate('')
    } catch (e) { toastCommandError(e) }
  }

  const preview = useStore(
    useShallow((s) => {
      const cust = getById(s.masters.customers, customerId)
      const issuerState =
        issuerKind === 'supplier' ? getById(s.masters.vendors, issuerVendorId)?.stateCode : getById(s.masters.units, invoice.unitId)?.stateCode
      const taxKind = deriveTaxKind(issuerState, cust?.stateCode)
      return { taxKind, ...computeInvoice(s, invoice, taxKind) }
    })
  )

  function onFinalize() {
    setSubmitting(true)
    try {
      const res = runFinalizeInvoice({
        invoiceId: invoice.id,
        customerId,
        issuerKind,
        issuerVendorId: issuerKind === 'supplier' ? issuerVendorId : undefined,
        invoiceDate: invoiceDate || undefined,
        ...dispatchFields,
      })
      toastCommandSuccess('Invoice issued', res.cascade)
      onDone()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  // Persist the header edits but keep the bill as a draft (no number minted, no snapshot).
  function onSaveDraft() {
    setSubmitting(true)
    try {
      const res = runEditDraftInvoice({
        invoiceId: invoice.id,
        customerId: customerId || undefined,
        issuerKind,
        issuerVendorId: issuerKind === 'supplier' ? issuerVendorId : undefined,
        invoiceDate: invoiceDate || undefined,
        ...dispatchFields,
      })
      toastCommandSuccess('Draft saved', res.cascade)
      onDone()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  const t = preview.totals
  const intra = preview.taxKind === 'cgst_sgst'

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={`Edit / issue bill ${invoice.billNo}`}
      description={`${preview.billedQty.toLocaleString('en-IN')} pcs · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" leftIcon={<Pencil size={14} />} onClick={onSaveDraft} loading={submitting} disabled={issuerKind === 'supplier' && !issuerVendorId}>
            Save draft
          </Button>
          <Button onClick={onFinalize} loading={submitting} disabled={!customerId || lines.length === 0 || (issuerKind === 'supplier' && !issuerVendorId)}>
            Issue invoice
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Consignee (Bill to) <span className="text-danger">*</span></span>
            <SearchableDropdown
              aria-label="Consignee (Bill to)"
              value={customerId}
              onChange={(v) => setCustomerId(v)}
              options={customers.map((c) => ({ value: c.id, label: c.name, subtitle: `GSTIN ${c.gstin} · state ${c.stateCode}` }))}
              placeholder="Select customer…"
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Issued by</span>
            <SearchableDropdown
              aria-label="Issued by"
              value={issuerKind}
              onChange={(v) => setIssuerKind(v as IssuerKind)}
              options={[
                { value: 'unit', label: 'This unit' },
                { value: 'supplier', label: 'RM supplier' },
              ]}
            />
          </label>
          {issuerKind === 'supplier' ? (
            <label className="flex flex-col gap-1.5">
              <span className="text-[11.5px] font-medium text-muted-fg">RM supplier <span className="text-danger">*</span></span>
              <SearchableDropdown
                aria-label="RM supplier"
                value={issuerVendorId}
                onChange={(v) => setIssuerVendorId(v)}
                options={rmVendors.map((v) => ({ value: v.id, label: v.name, subtitle: `${v.code} · state ${v.stateCode}` }))}
                placeholder="Select supplier…"
              />
            </label>
          ) : null}
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Invoice date</span>
            <input type="date" className="input h-9" value={invoiceDate} onChange={(e) => setInvoiceDate(e.target.value)} />
          </label>
        </div>

        {/* Dispatch & transport — all optional, printed on the GST invoice. */}
        <details className="rounded-lg border border-border" open={!!(ewayBillNo || vehicleNo || transporter || dispatchedThrough || destination)}>
          <summary className="cursor-pointer select-none px-3 py-2 text-[12px] font-semibold text-muted-fg">Dispatch &amp; transport <span className="font-normal">(optional)</span></summary>
          <div className="grid grid-cols-1 gap-3 border-t border-border p-3 sm:grid-cols-2 lg:grid-cols-3">
            <TxtField label="E-Way Bill No" value={ewayBillNo} set={setEwayBillNo} placeholder="e.g. 1234 5678 9012" />
            <TxtField label="Vehicle No" value={vehicleNo} set={setVehicleNo} placeholder="e.g. MH12 AB 3456" />
            <TxtField label="Transporter" value={transporter} set={setTransporter} placeholder="Transporter / LR" />
            <TxtField label="Dispatched through" value={dispatchedThrough} set={setDispatchedThrough} placeholder="Courier / By road" />
            <TxtField label="Destination" value={destination} set={setDestination} placeholder="Delivery city / place" />
          </div>
        </details>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-semibold">Part</th>
                <th className="px-3 py-2 font-semibold">Challan</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Rate ₹</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.dispatchId} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{l.partNo} <span className="text-faint">· {l.gstPct}%</span></td>
                  <td className="px-3 py-1.5 mono text-muted-fg">{l.challanNo}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number" min={1} aria-label={`Qty for ${l.partNo} ${l.challanNo}`}
                      value={qtyBuf[l.dispatchId] ?? String(l.qty)}
                      onChange={(e) => setQtyBuf((p) => ({ ...p, [l.dispatchId]: e.target.value }))}
                      onBlur={() => commitLine(l)}
                      className="cell-input w-20 text-right" disabled={!canEdit}
                    />
                  </td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number" min={0} step="0.01" aria-label={`Rate for ${l.partNo} ${l.challanNo}`}
                      value={rateBuf[l.dispatchId] ?? String(fromPaise(l.ratePaise))}
                      onChange={(e) => setRateBuf((p) => ({ ...p, [l.dispatchId]: e.target.value }))}
                      onBlur={() => commitLine(l)}
                      className="cell-input w-20 text-right" disabled={!canEdit}
                    />
                  </td>
                  <td className="px-3 py-1.5 text-right mono">{formatINRSymbol(l.amountPaise)}</td>
                  <td className="px-2 py-1.5 text-right">
                    {canEdit ? (
                      <button type="button" onClick={() => removeLine(l.dispatchId)} aria-label={`Remove ${l.partNo} ${l.challanNo}`} className="rounded p-1 text-faint hover:bg-danger/10 hover:text-danger">
                        <Trash2 size={13} />
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Add another part / challan (multi-challan, multi-part billing — SRS FR-B105). */}
        {canEdit ? (
          openChallans.length ? (
            <div className="flex flex-wrap items-end gap-2 rounded-lg border border-dashed border-border p-2.5">
              <label className="flex min-w-[200px] grow flex-col gap-1">
                <span className="text-[10.5px] font-medium text-muted-fg">Add inward challan</span>
                <SearchableDropdown
                  aria-label="Add inward challan"
                  value={addChallanId}
                  onChange={pickAddChallan}
                  options={openChallans.map((r) => ({ value: r.inward.id, label: r.inward.challanNo, subtitle: `${r.partNo} · avail ${r.available.toLocaleString('en-IN')}` }))}
                  placeholder="Pick a challan to bill…"
                />
              </label>
              <label className="flex w-24 flex-col gap-1">
                <span className="text-[10.5px] font-medium text-muted-fg">Qty</span>
                <input type="number" min={1} aria-label="New line qty" className="input h-9 text-right" value={addQty} onChange={(e) => setAddQty(e.target.value)} />
              </label>
              <label className="flex w-24 flex-col gap-1">
                <span className="text-[10.5px] font-medium text-muted-fg">Rate ₹</span>
                <input type="number" min={0} step="0.01" aria-label="New line rate" className="input h-9 text-right" value={addRate} onChange={(e) => setAddRate(e.target.value)} />
              </label>
              <Button variant="secondary" leftIcon={<Plus size={14} />} onClick={addLine} disabled={!addChallanId || !addQty || !addRate}>Add line</Button>
            </div>
          ) : (
            <p className="text-[12px] text-muted-fg">No other open challans in this unit to add.</p>
          )
        ) : null}

        {/* Packing Details — client review §13: compulsory in the invoice form.
            Derived from each part's Avg Qty per Box (same basis as the printed invoice). */}
        <div className="rounded-lg border border-border">
          <div className="border-b border-border bg-muted px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-muted-fg">
            Packing Details
          </div>
          <div className="p-3">
            {preview.packing.length === 0 ? (
              <p className="text-[12px] text-faint">No packing yet — set “Avg Qty per Box” on the parts to compute boxes.</p>
            ) : (
              <div className="space-y-1 text-[12.5px]">
                {preview.packing.map((b, i) => (
                  <div key={i} className="flex items-center justify-between">
                    <span className="mono text-muted-fg">{b.boxes} {b.mode ?? 'box'} × {b.qtyPerBox.toLocaleString('en-IN')}</span>
                    <span className="mono font-medium">{(b.boxes * b.qtyPerBox).toLocaleString('en-IN')}</span>
                  </div>
                ))}
                {(() => {
                  const t = packingTotal(preview.packing)
                  return (
                    <div className="flex items-center justify-between border-t border-border pt-1 font-semibold">
                      <span>Total {t.boxes} {t.mode ?? ''}box(es)</span>
                      <span className="mono">{t.qty.toLocaleString('en-IN')}</span>
                    </div>
                  )
                })()}
              </div>
            )}
          </div>
        </div>

        <div className="ml-auto w-full max-w-xs space-y-1 text-[13px]">
          <Row label="Assessable" value={formatINRSymbol(t.assessable)} />
          {intra ? (
            <>
              <Row label="CGST" value={formatINRSymbol(t.cgst)} />
              <Row label="SGST" value={formatINRSymbol(t.sgst)} />
            </>
          ) : (
            <Row label="IGST" value={formatINRSymbol(t.igst)} />
          )}
          <Row label="Round off" value={formatINRSymbol(t.roundOff)} />
          <div className="flex justify-between border-t border-border pt-1.5 text-base font-bold">
            <span>Grand</span>
            <span className="text-primary">{formatINRSymbol(t.grand)}</span>
          </div>
          <p className="pt-1 text-[11px] text-faint">{intra ? 'Intra-state → CGST + SGST' : 'Inter-state → IGST'}</p>
        </div>
      </div>
    </Drawer>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-muted-fg">{label}</span>
      <span className="mono">{value}</span>
    </div>
  )
}

/**
 * On-screen GST Tax Invoice preview — the full client format, built from
 * `selectInvoiceDocModel`: part-grouped lines, each carrying its Customer D.C
 * rows and the RM-traceability block (Die/Bin/Heat/RM supplier). Rendered as an
 * HTML "paper" sheet (#invoice-print, white + theme-independent so it prints
 * cleanly). Print outputs only the sheet; Download PDF reuses the @react-pdf doc.
 */
function InvoicePreview({ invoiceId, onClose, onPdf }: { invoiceId: Id; onClose: () => void; onPdf: () => void }) {
  const m = useStore(useShallow((s): InvoiceDocModel | null => selectInvoiceDocModel(s, invoiceId)))

  if (!m) {
    return (
      <Modal open onClose={onClose} title="Invoice preview" size="md">
        <p className="text-sm text-muted-fg">This invoice could not be found.</p>
      </Modal>
    )
  }

  const intra = m.taxKind === 'cgst_sgst'
  const half = m.uniformGstPct != null ? m.uniformGstPct / 2 : undefined

  return (
    <Modal
      open
      onClose={onClose}
      size="xl"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Close</Button>
          <Button variant="secondary" leftIcon={<Printer size={15} />} onClick={() => window.print()}>Print</Button>
          <Button leftIcon={<FileDown size={15} />} onClick={onPdf}>Download PDF</Button>
        </>
      }
    >
      {/* The printable invoice sheet (always light, so it prints like paper). */}
      <div id="invoice-print" className="bg-white p-5 text-[11px] leading-snug text-[#0f172a] ring-1 ring-[#cbd5e1]">
        {/* Title band */}
        <div className="flex items-center justify-between gap-4 border-b-2 border-[#0f172a] pb-2.5">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-md bg-[#2563eb] text-[13px] font-bold text-white">
              {(m.issuerName || 'HE').slice(0, 2).toUpperCase()}
            </span>
            <div className="leading-tight">
              <div className="text-[17px] font-extrabold tracking-wide text-[#0f172a]">TAX INVOICE</div>
              <div className="text-[8px] font-semibold uppercase tracking-[0.18em] text-[#64748b]">Goods &amp; Services Tax</div>
            </div>
          </div>
          <div className="text-right text-[8px] leading-tight text-[#64748b]">
            <span className="mb-1 inline-block rounded-sm border border-[#94a3b8] px-1.5 py-px text-[7.5px] font-semibold uppercase tracking-[0.12em] text-[#475569]">
              Original for Recipient
            </span>
            <div>U/s 31 of CGST &amp; SGST Act</div>
            <div>R.W Section 20 of IGST Act</div>
          </div>
        </div>

        {/* Supplier + invoice meta */}
        <div className="grid grid-cols-1 border border-t-0 border-[#cbd5e1] sm:grid-cols-2">
          <div className="space-y-0.5 border-b border-[#cbd5e1] p-2.5 sm:border-b-0 sm:border-r">
            <div className="text-[12.5px] font-bold text-[#1e3a8a]">{m.issuerName || 'Hemant Engineering Works'}</div>
            {m.issuerAddress.map((l, i) => <div key={i} className="text-[#475569]">{l}</div>)}
            <KV k="GSTIN/UIN" v={m.issuerGstin || '—'} mono />
            <KV k="State Code" v={m.issuerState || '—'} />
            <KV k="PAN No" v={m.issuerPan || '—'} mono />
          </div>
          <div className="space-y-0.5 p-2.5">
            <KV k="Invoice No" v={m.invoiceNo} mono strong />
            <KV k="Invoice Date" v={m.invoiceDate} />
            <KV k="PO / Jobwork No" v={m.poJobworkNo || '—'} />
            <KV k="Motor Vehicle No" v={m.motorVehicleNo || '—'} mono />
            <KV k="Dispatched Through" v={m.dispatchedThrough || '—'} />
            <KV k="Terms of Payment" v={m.termsOfPayment || '—'} />
            <KV k="Due Date" v={m.dueDate || '—'} />
          </div>
        </div>

        {/* Dynamic billed-to and shipped-to parties */}
        <div className="grid grid-cols-2 border border-t-0 border-[#cbd5e1]">
          <div className="space-y-0.5 border-r border-[#cbd5e1] p-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-[#64748b]">Details of Receiver (Billed To)</div>
            <div className="text-[12.5px] font-bold text-[#1e3a8a]">{m.custName}</div>
            {m.custAddress.map((l, i) => <div key={i} className="text-[#475569]">{l}</div>)}
            <KV k="GSTIN/UIN" v={m.custGstin || '—'} mono />
            <KV k="State Code" v={m.custState || '—'} />
            <KV k="PAN No" v={m.custPan || '—'} mono />
          </div>
          <div className="space-y-0.5 p-2.5">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-[#64748b]">Details of Consignee (Shipped To)</div>
            <div className="text-[12.5px] font-bold text-[#1e3a8a]">{m.shipName}</div>
            {m.shipAddress.map((l, i) => <div key={i} className="text-[#475569]">{l}</div>)}
            <KV k="GSTIN/UIN" v={m.shipGstin || '—'} mono />
            <KV k="State Code" v={m.shipState || '—'} />
            <KV k="PAN No" v={m.shipPan || '—'} mono />
            <KV k="Email ID" v={m.contactEmail || '—'} />
            <KV k="GST Type" v={m.gstType} />
          </div>
        </div>

        {/* Line items — one part row, many Customer D.C sub-lines */}
        <table className="w-full border-collapse text-[10.5px]">
          <thead>
            <tr className="bg-[#f1f5f9] text-left text-[9px] uppercase tracking-wide text-[#475569]">
              <Th>Sl</Th>
              <Th>Description &amp; Specification of Goods</Th>
              <Th>Customer D.C No</Th>
              <Th>D.C Date</Th>
              <Th>HSN/SAC</Th>
              <Th className="text-right">Qty (Nos)</Th>
              <Th className="text-right">Rate</Th>
              <Th className="text-right">Amount ₹</Th>
            </tr>
          </thead>
          <tbody>
            {m.parts.length === 0 ? (
              <tr><Td colSpan={8} className="py-3 text-center text-[#64748b]">No billed lines on this invoice yet.</Td></tr>
            ) : m.parts.map((p, i) => (
              <tr key={i} className="align-top">
                <Td>{i + 1}</Td>
                <Td className="space-y-0.5">
                  <Spec k="Part No" v={p.partNo} bold />
                  {p.partType ? <Spec k="Part Type" v={p.partType} /> : null}
                  {p.dieNo ? <Spec k="Die No" v={p.dieNo} /> : null}
                  {p.drgEdtNo ? <Spec k="Drg Edt No" v={p.drgEdtNo} /> : null}
                  {p.ircBinNo ? <Spec k="IRC / Bin No" v={p.ircBinNo} /> : null}
                  {p.heatNos.length ? <Spec k="Heat No" v={p.heatNos.join(', ')} /> : null}
                  {p.rmSupplier ? <Spec k="RM Supplier" v={p.rmSupplier} /> : null}
                  {p.finishWeightG != null ? <Spec k="Finish Weight" v={`${p.finishWeightG} GM`} /> : null}
                  {p.packingMode ? <Spec k="Packing Mode" v={p.packingMode} /> : null}
                </Td>
                <Td className="font-mono">{p.dcs.map((d, j) => <div key={j}>{d.dcNo}</div>)}</Td>
                <Td className="font-mono">{p.dcs.map((d, j) => <div key={j}>{d.dcDate || '—'}</div>)}</Td>
                <Td className="font-mono">{p.hsnSac || '—'}</Td>
                <Td className="text-right font-mono">
                  {p.dcs.map((d, j) => <div key={j}>{d.qty.toLocaleString('en-IN')}</div>)}
                  {p.dcs.length > 1 ? <div className="mt-0.5 border-t border-[#cbd5e1] pt-0.5 font-semibold">{p.totalQty.toLocaleString('en-IN')}</div> : null}
                </Td>
                <Td className="text-right font-mono">{p.dcs.map((d, j) => <div key={j}>{formatINR(d.ratePaise)}</div>)}</Td>
                <Td className="text-right font-mono">
                  {p.dcs.map((d, j) => <div key={j}>{formatINR(d.amountPaise)}</div>)}
                  {p.dcs.length > 1 ? <div className="mt-0.5 border-t border-[#cbd5e1] pt-0.5 font-semibold">{formatINR(p.totalAmountPaise)}</div> : null}
                </Td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Notes + packing + totals */}
        <div className="grid grid-cols-1 border border-t-0 border-[#cbd5e1] sm:grid-cols-[1.5fr_1fr]">
          <div className="border-b border-[#cbd5e1] p-2.5 sm:border-b-0 sm:border-r">
            <div className="font-semibold">Note: Machining charges of your forged rings</div>
            <ol className="ml-4 list-decimal text-[#475569]">
              <li>All material in oiled condition.</li>
              <li>All material packed in GSP wooden boxes.</li>
              <li>Sample inspection &amp; MPI report attached.</li>
            </ol>
            <div className="mt-2 text-[9px] font-semibold uppercase tracking-wide text-[#64748b]">Packing Details</div>
            {m.packing.length ? (
              <>
                {m.packing.map((b, i) => <div key={i} className="font-mono">{packingLineLabel(b)}</div>)}
                {(() => { const t = packingTotal(m.packing); return <div className="font-mono font-semibold">TOTAL {t.boxes} {t.mode ?? ''}= {t.qty.toLocaleString('en-IN')}</div> })()}
              </>
            ) : <div>—</div>}
          </div>
          <div className="space-y-0.5 p-2.5">
            <TR k="Assessable Value" v={formatINR(m.totals.assessable)} />
            {intra ? (
              <>
                <TR k={`CGST${half != null ? ` @ ${half}%` : ''}`} v={formatINR(m.totals.cgst)} />
                <TR k={`SGST${half != null ? ` @ ${half}%` : ''}`} v={formatINR(m.totals.sgst)} />
              </>
            ) : (
              <TR k={`IGST${m.uniformGstPct != null ? ` @ ${m.uniformGstPct}%` : ''}`} v={formatINR(m.totals.igst)} />
            )}
            <TR k="Rounding off (+/-)" v={formatINR(m.totals.roundOff)} />
            <div className="-mx-2.5 -mb-2.5 mt-1.5 flex items-center justify-between gap-2 bg-[#0f172a] px-2.5 py-2 text-[13px] font-bold text-white">
              <span className="uppercase tracking-wide">Grand Total</span>
              <span className="font-mono text-[14px]">₹ {formatINR(m.totals.grand)}</span>
            </div>
          </div>
        </div>

        {/* Amount in words */}
        <div className="border border-t-0 border-[#cbd5e1] px-2.5 py-1.5">
          <span className="font-semibold">Amount (in words):</span> {m.amountWords}
        </div>

        {/* Certification */}
        <p className="border border-t-0 border-[#cbd5e1] p-2.5 text-[8.5px] leading-snug text-[#64748b]">
          Certified that the particulars given above are true and correct, that the amount indicated represents the
          price actually charged, and that there is no flow of additional consideration directly or indirectly from
          the buyer.
        </p>

        {/* Terms & Conditions + bank + signatory */}
        <div className="grid grid-cols-1 border border-t-0 border-[#cbd5e1] sm:grid-cols-3">
          <div className="border-b border-[#cbd5e1] p-2.5 sm:border-b-0 sm:border-r">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-[#64748b]">Terms &amp; Conditions</div>
            <ol className="ml-4 list-decimal text-[#475569]">
              <li>Raise objections within 3 days of receipt.</li>
              <li>Interest @ 12% p.a. on overdue bills.</li>
              <li>Subject to Pune jurisdiction.</li>
            </ol>
          </div>
          <div className="border-b border-[#cbd5e1] p-2.5 sm:border-b-0 sm:border-r">
            <div className="text-[9px] font-semibold uppercase tracking-wide text-[#64748b]">Our Bank Details</div>
            {m.issuerBank?.name ? (
              <>
                <div>{m.issuerBank.name}</div>
                {m.issuerBank.branch ? <div>Branch {m.issuerBank.branch}</div> : null}
                <div className="font-mono">A/c {m.issuerBank.acc || '—'}</div>
                <div className="font-mono">IFSC {m.issuerBank.ifsc || '—'}</div>
              </>
            ) : <div>—</div>}
          </div>
          <div className="p-2.5 text-right">
            <div className="font-semibold">For {m.issuerName}</div>
            <div className="mt-8 text-[#64748b]">Authorised Signatory</div>
          </div>
        </div>
      </div>
    </Modal>
  )
}

function TxtField({ label, value, set, placeholder }: { label: string; value: string; set: (v: string) => void; placeholder?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-fg">{label}</span>
      <input type="text" className="input h-9" value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
    </label>
  )
}

function KV({ k, v, mono, strong }: { k: string; v: string; mono?: boolean; strong?: boolean }) {
  return (
    <div className="flex gap-1.5 text-[10.5px]">
      <span className="shrink-0 text-[#64748b]">{k}:</span>
      <span className={`${mono ? 'font-mono ' : ''}${strong ? 'font-bold' : ''}`}>{v}</span>
    </div>
  )
}

function Spec({ k, v, bold }: { k: string; v: string; bold?: boolean }) {
  return (
    <div className="text-[10.5px]">
      <span className="font-semibold text-[#475569]">{k}:</span> <span className={bold ? 'font-bold' : undefined}>{v}</span>
    </div>
  )
}

function Th({ children, className }: { children: React.ReactNode; className?: string }) {
  return <th className={`border border-[#cbd5e1] px-1.5 py-1 font-semibold ${className ?? ''}`}>{children}</th>
}

function Td({ children, className, colSpan }: { children: React.ReactNode; className?: string; colSpan?: number }) {
  return <td colSpan={colSpan} className={`border border-[#cbd5e1] px-1.5 py-1 align-top ${className ?? ''}`}>{children}</td>
}

function TR({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-[#475569]">{k}</span>
      <span className="font-mono">{v}</span>
    </div>
  )
}
