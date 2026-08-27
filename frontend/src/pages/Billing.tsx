import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ReceiptText, FileDown, Ban, FileSignature } from 'lucide-react'
import { formatINRSymbol } from '@/lib/money'
import { formatDMY } from '@/lib/date'
import type { Id, Invoice, IssuerKind } from '@/types/domain'
import { useStore } from '@/store'
import { getById, values } from '@/store/normalized'
import { runFinalizeInvoice, runVoidInvoice } from '@/store/billingCommands'
import {
  selectInvoiceRows,
  selectInvoiceLines,
  computeInvoice,
  deriveTaxKind,
  selectInvoicePdfModel,
  type InvoiceRow,
} from '@/selectors/invoiceCompute'
import type { PaymentStatus } from '@/selectors/billing'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Badge, Button, Card, Drawer, EmptyState, SearchableDropdown, Tabs, type BadgeTone } from '@/components/ui'
import { toast } from 'sonner'

type StatusFilter = 'all' | 'draft' | 'sent' | 'paid' | 'overdue'
const FILTERS = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Drafts' },
  { value: 'sent', label: 'Issued' },
  { value: 'paid', label: 'Paid' },
  { value: 'overdue', label: 'Overdue' },
] as const

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
  const [selected, setSelected] = useState<Set<Id>>(new Set())

  const canEdit = can('billing', 'edit')

  const shown = useMemo(
    () =>
      rows.filter((r) => {
        if (tab === 'all') return true
        if (tab === 'draft') return r.invoice.lifecycle === 'draft'
        if (tab === 'sent') return r.invoice.lifecycle === 'sent'
        if (tab === 'paid') return r.status === 'paid'
        if (tab === 'overdue') return r.status === 'overdue'
        return true
      }),
    [rows, tab]
  )

  const selectableSent = shown.filter((r) => r.invoice.lifecycle === 'sent')

  async function downloadPdf(id: Id) {
    const model = selectInvoicePdfModel(useStore.getState(), id)
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
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Billing</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">GST invoices per Bill No — finalize drafts, issue, and export.</p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <Tabs items={FILTERS} value={tab} onChange={setTab} ariaLabel="Filter invoices" />
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
              {shown.map((r) => (
                <BillingRow
                  key={r.invoice.id}
                  row={r}
                  canEdit={canEdit}
                  checked={selected.has(r.invoice.id)}
                  onCheck={() => toggleSel(r.invoice.id)}
                  onFinalize={() => setBuilder(r.invoice)}
                  onPdf={() => downloadPdf(r.invoice.id)}
                  onVoid={() => onVoid(r.invoice.id)}
                />
              ))}
            </tbody>
          </table>
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
          onDone={() => setBuilder(null)}
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
  onFinalize,
  onPdf,
  onVoid,
}: {
  row: InvoiceRow
  canEdit: boolean
  checked: boolean
  onCheck: () => void
  onFinalize: () => void
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
        <div className="flex items-center justify-end gap-1">
          {isDraft && canEdit ? (
            <Button size="sm" leftIcon={<FileSignature size={14} />} onClick={onFinalize}>
              Finalize
            </Button>
          ) : null}
          {isSent ? (
            <button type="button" className="btn btn-ghost h-8 w-8 p-0" aria-label={`Download PDF for ${inv.billNo}`} onClick={onPdf}>
              <FileDown size={15} />
            </button>
          ) : null}
          {isSent && canEdit ? (
            <button type="button" className="btn btn-ghost h-8 w-8 p-0 text-danger" aria-label={`Void ${inv.billNo}`} onClick={onVoid}>
              <Ban size={15} />
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  )
}

function InvoiceBuilder({ invoice, onClose, onDone }: { invoice: Invoice; onClose: () => void; onDone: () => void }) {
  const customers = useStore(useShallow((st) => values(st.masters.customers).filter((c) => c.active)))
  const rmVendors = useStore(useShallow((st) => values(st.masters.vendors).filter((v) => v.active && v.type === 'rm' && v.gstin)))
  // Reactive: reflects undo/redo or master edits while the modal is open.
  const lines = useStore(useShallow((s) => selectInvoiceLines(s, invoice)))

  const [customerId, setCustomerId] = useState(invoice.customerId ?? '')
  const [issuerKind, setIssuerKind] = useState<IssuerKind>(invoice.issuerKind)
  const [issuerVendorId, setIssuerVendorId] = useState('')
  const [invoiceDate, setInvoiceDate] = useState(invoice.invoiceDate)
  const [submitting, setSubmitting] = useState(false)

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
      })
      toastCommandSuccess('Invoice issued', res.cascade)
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
      title={`Finalize bill ${invoice.billNo}`}
      description={`${preview.billedQty.toLocaleString('en-IN')} pcs · ${lines.length} line${lines.length === 1 ? '' : 's'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
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

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-semibold">Part</th>
                <th className="px-3 py-2 font-semibold">Challan</th>
                <th className="px-3 py-2 text-right font-semibold">Qty</th>
                <th className="px-3 py-2 text-right font-semibold">Rate</th>
                <th className="px-3 py-2 text-right font-semibold">Amount</th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.dispatchId} className="border-t border-border/60">
                  <td className="px-3 py-1.5">{l.partNo} <span className="text-faint">· {l.gstPct}%</span></td>
                  <td className="px-3 py-1.5 mono text-muted-fg">{l.challanNo}</td>
                  <td className="px-3 py-1.5 text-right mono">{l.qty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-1.5 text-right mono">{formatINRSymbol(l.ratePaise)}</td>
                  <td className="px-3 py-1.5 text-right mono">{formatINRSymbol(l.amountPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
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
