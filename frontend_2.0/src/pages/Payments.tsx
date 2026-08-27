import { useMemo, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Wallet, Plus, RotateCcw } from 'lucide-react'
import { addP, formatINR, formatINRSymbol, fromPaise, toPaise, type Paise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import type { Id, Payment, PaymentMode } from '@/types/domain'
import { useStore } from '@/store'
import { getById, values } from '@/store/normalized'
import { allowedUnitIds } from '@/store/scope'
import { runRecordPayment, runReversePayment } from '@/store/billingCommands'
import { selectInvoiceRows } from '@/selectors/invoiceCompute'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, SearchableDropdown, TablePager } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'

const ZERO = 0 as Paise
const MODES: PaymentMode[] = ['rtgs', 'neft', 'cheque', 'upi', 'cash', 'bank']

export default function Payments() {
  const can = useCan()
  const invoiceRows = useStore(useShallow(selectInvoiceRows))
  const payments = useStore(
    useShallow((s) => {
      const allowed = allowedUnitIds(s)
      return values(s.payments.payments)
        .filter((p) => p.allocations.some((a) => allowed.has(getById(s.billing.invoices, a.invoiceId)?.unitId ?? '')))
        .sort((a, b) => b.date.localeCompare(a.date))
    })
  )
  const billOf = useStore((s) => (id: Id) => getById(s.billing.invoices, id)?.billNo ?? '—')
  const [recording, setRecording] = useState(false)
  const [reversing, setReversing] = useState<Payment | null>(null)
  const [reverseBusy, setReverseBusy] = useState(false)
  // Server-driven table in API mode; bump after a write so the fetched page reflects it.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)

  function onReverse() {
    if (!reversing) return
    setReverseBusy(true)
    try {
      const res = runReversePayment(reversing.id)
      toastCommandSuccess('Payment reversed', res.cascade)
      setReversing(null)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setReverseBusy(false)
    }
  }

  const outstanding = useMemo(
    () => invoiceRows.filter((r) => r.invoice.lifecycle === 'sent' && r.outstanding > 0),
    [invoiceRows]
  )
  const paged = usePagedSource({
    localRows: payments,
    endpoint: '/payments',
    searchText: (r) => `${r.ref ?? ''} ${r.mode ?? ''}`,
    pageSize: 25,
    refreshKey,
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Payments</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Receipts allocated across one or more bills.</p>
        </div>
        <input
          className="input h-9 w-56 ml-auto"
          placeholder="Search…"
          aria-label="Search"
          value={paged.search}
          onChange={(e) => paged.setSearch(e.target.value)}
        />
        {can('payments', 'create') ? (
          <Button leftIcon={<Plus size={15} />} onClick={() => setRecording(true)} disabled={outstanding.length === 0}>
            Record payment
          </Button>
        ) : null}
      </div>

      {payments.length === 0 ? (
        <Card>
          <EmptyState
            icon={Wallet}
            title="No payments yet"
            description={outstanding.length === 0 ? 'Issue and bill invoices first.' : 'Record a receipt against an outstanding bill.'}
            action={
              can('payments', 'create') ? (
                <Button leftIcon={<Plus size={15} />} onClick={() => setRecording(true)} disabled={outstanding.length === 0}>
                  Record payment
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
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Mode</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Ref</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Amount</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Allocated to</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((p) => (
                <tr key={p.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(p.date)}</td>
                  <td className="px-3 py-2.5"><Badge tone="primary" className="uppercase">{p.mode}</Badge></td>
                  <td className="px-3 py-2.5 mono">{p.ref || '—'}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(p.amountPaise)}</td>
                  <td className="px-3 py-2.5 mono text-muted-fg">
                    {p.allocations.map((a) => `${billOf(a.invoiceId)} (${formatINR(a.amountPaise)})`).join(', ')}
                  </td>
                  <td className="px-3 py-2.5 text-right">
                    {can('payments', 'delete') ? (
                      <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" leftIcon={<RotateCcw size={13} />} onClick={() => setReversing(p)}>
                        Reverse
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      {recording ? (
        <RecordPaymentModal
          outstanding={outstanding.map((r) => ({ id: r.invoice.id, billNo: r.invoice.billNo, customer: r.customerName, outstanding: r.outstanding }))}
          onClose={() => { setRecording(false); bumpRefresh() }}
          onDone={() => { setRecording(false); bumpRefresh() }}
        />
      ) : null}

      <ConfirmDialog
        open={reversing != null}
        onClose={() => setReversing(null)}
        onConfirm={onReverse}
        loading={reverseBusy}
        tone="danger"
        title="Reverse this payment?"
        confirmLabel="Reverse"
        message={
          reversing ? (
            <>Reverse the {formatINRSymbol(reversing.amountPaise)} {reversing.mode.toUpperCase()} receipt
              {reversing.ref ? <> (ref <b>{reversing.ref}</b>)</> : null}? The allocated bills' outstanding is restored. This can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

interface OutRow { id: Id; billNo: string; customer: string; outstanding: Paise }

function RecordPaymentModal({ outstanding, onClose, onDone }: { outstanding: OutRow[]; onClose: () => void; onDone: () => void }) {
  const [mode, setMode] = useState<PaymentMode>('rtgs')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayISO())
  const [alloc, setAlloc] = useState<Record<Id, string>>({})
  const [submitting, setSubmitting] = useState(false)

  const allocations = useMemo(
    () =>
      Object.entries(alloc)
        .map(([invoiceId, v]) => ({ invoiceId, amountPaise: v ? toPaise(Number(v)) : ZERO }))
        .filter((a) => a.amountPaise > 0),
    [alloc]
  )
  const total = useMemo(() => allocations.reduce((acc, a) => addP(acc, a.amountPaise), ZERO), [allocations])

  function setAmt(id: Id, v: string) {
    setAlloc((prev) => ({ ...prev, [id]: v }))
  }
  function fill(id: Id, out: Paise) {
    setAlloc((prev) => ({ ...prev, [id]: String(fromPaise(out)) }))
  }

  function onSave() {
    setSubmitting(true)
    try {
      const res = runRecordPayment({ mode, ref: ref.trim(), date, amountPaise: total, allocations })
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
      size="lg"
      title="Record payment"
      description="Tick the bills this receipt settles; one instrument can clear several."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={allocations.length === 0}>
            Receive {formatINRSymbol(total)}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Mode</span>
            <SearchableDropdown
              aria-label="Mode"
              value={mode}
              onChange={(v) => setMode(v as PaymentMode)}
              options={MODES.map((m) => ({ value: m, label: m.toUpperCase() }))}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Ref / UTR / cheque no</span>
            <input className="input h-9" value={ref} onChange={(e) => setRef(e.target.value)} />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-[11.5px] font-medium text-muted-fg">Date</span>
            <input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
        </div>

        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th className="px-3 py-2 font-semibold">Bill</th>
                <th className="px-3 py-2 font-semibold">Customer</th>
                <th className="px-3 py-2 text-right font-semibold">Outstanding</th>
                <th className="px-3 py-2 text-right font-semibold">Allocate</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {outstanding.map((o) => (
                <tr key={o.id} className="border-t border-border/60">
                  <td className="px-3 py-1.5 mono">{o.billNo}</td>
                  <td className="px-3 py-1.5">{o.customer}</td>
                  <td className="px-3 py-1.5 text-right mono text-muted-fg">{formatINRSymbol(o.outstanding)}</td>
                  <td className="px-2 py-1.5">
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={alloc[o.id] ?? ''}
                      onChange={(e) => setAmt(o.id, e.target.value)}
                      aria-label={`Allocate to ${o.billNo}`}
                      className="cell-input text-right"
                    />
                  </td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      className="text-[11px] text-primary hover:underline"
                      aria-label={`Allocate the full outstanding ${formatINRSymbol(o.outstanding)} to ${o.billNo}`}
                      onClick={() => fill(o.id, o.outstanding)}
                    >
                      full
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-end gap-2 text-[13px]">
          <span className="text-muted-fg">Payment total</span>
          <span className="mono text-base font-bold text-primary">{formatINRSymbol(total)}</span>
        </div>
      </div>
    </Drawer>
  )
}
