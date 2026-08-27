import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Banknote, Plus, IndianRupee, Pencil, Trash2 } from 'lucide-react'
import { formatINRSymbol, fromPaise, toPaise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import type { Expense, PaymentMode } from '@/types/domain'
import { useStore } from '@/store'
import { unitOptions, vendorOptions } from '@/masters/options'
import { runSaveExpense, runRecordExpensePayment, runDeleteExpense } from '@/store/expenseCommands'
import { selectExpenseRows, selectVendorOutstanding, type ExpenseRow, type ExpenseStatus } from '@/selectors/finance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, SearchableDropdown, type BadgeTone } from '@/components/ui'

const numOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const STATUS_TONE: Record<ExpenseStatus, BadgeTone> = { unpaid: 'primary', partial: 'warning', overdue: 'danger', paid: 'success' }
const MODES: PaymentMode[] = ['rtgs', 'neft', 'cheque', 'upi', 'cash', 'bank']

export default function Expenses() {
  const can = useCan()
  const units = useStore(unitOptions)
  const vendors = useStore(vendorOptions)
  const rows = useStore(useShallow(selectExpenseRows))
  const vendorOut = useStore(useShallow(selectVendorOutstanding))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [paying, setPaying] = useState<ExpenseRow | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteExpense(deleting.id)
      toastCommandSuccess('Expense deleted', res.cascade)
      setDeleting(null)
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Expenses</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Overheads with instalment tracking and vendor-wise outstanding.</p>
        </div>
        {can('expenses', 'create') ? (
          <Button className="ml-auto" leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New expense</Button>
        ) : null}
      </div>

      {vendorOut.length > 0 ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Vendor-wise outstanding</div>
          <ul className="divide-y divide-border text-[13px]">
            {vendorOut.map((v) => (
              <li key={v.vendorName} className="flex items-center justify-between px-4 py-2">
                <span>{v.vendorName} <span className="text-faint">· {v.count} bill{v.count === 1 ? '' : 's'}</span></span>
                <span className="mono font-semibold text-warning">{formatINRSymbol(v.outstanding)}</span>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={Banknote} title="No expenses" description="Record an overhead expense to track payments." action={can('expenses', 'create') ? <Button leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New expense</Button> : undefined} /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Category</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Vendor</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Paid</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Balance</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.expense.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.expense.date)}</td>
                  <td className="px-3 py-2.5">{r.expense.category}</td>
                  <td className="px-3 py-2.5">{r.vendorName}</td>
                  <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(r.expense.totalPaise)}</td>
                  <td className="px-3 py-2.5 text-right mono text-muted-fg">{formatINRSymbol(r.paid)}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.balance)}</td>
                  <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status]} className="capitalize">{r.status}</Badge></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {can('expenses', 'edit') && r.balance > 0 ? (
                        <Button size="sm" variant="secondary" leftIcon={<IndianRupee size={13} />} onClick={() => setPaying(r)}>Pay</Button>
                      ) : null}
                      {can('expenses', 'edit') ? (
                        <Button size="sm" variant="ghost" aria-label={`Edit ${r.expense.category}`} title="Edit" onClick={() => setEditing(r.expense)}><Pencil size={14} /></Button>
                      ) : null}
                      {can('expenses', 'delete') ? (
                        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete ${r.expense.category}`} title="Delete" onClick={() => setDeleting(r.expense)}><Trash2 size={14} /></Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating ? <ExpenseForm units={units} vendors={vendors} onClose={() => setCreating(false)} /> : null}
      {editing ? <ExpenseForm units={units} vendors={vendors} existing={editing} onClose={() => setEditing(null)} /> : null}
      {paying ? <PayModal row={paying} onClose={() => setPaying(null)} /> : null}
      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        loading={deleteBusy}
        tone="danger"
        title="Delete expense?"
        confirmLabel="Delete"
        message={
          deleting ? (
            <>Delete <b>{deleting.category}</b> ({formatINRSymbol(deleting.totalPaise)})? This also removes its recorded payments and can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

function ExpenseForm({
  units,
  vendors,
  existing,
  onClose,
}: {
  units: { value: string; label: string }[]
  vendors: { value: string; label: string }[]
  existing?: Expense
  onClose: () => void
}) {
  const [unitId, setUnitId] = useState(existing?.unitId ?? '')
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '')
  const [category, setCategory] = useState(existing?.category ?? '')
  const [date, setDate] = useState(existing?.date ?? todayISO())
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? '')
  const [total, setTotal] = useState(existing ? String(fromPaise(existing.totalPaise)) : '')
  const [submitting, setSubmitting] = useState(false)

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveExpense({
        id: existing?.id,
        unitId,
        vendorId: vendorId || undefined,
        category: category.trim(),
        date,
        dueDate: dueDate || undefined,
        totalPaise: toPaise(numOf(total)),
      })
      toastCommandSuccess(existing ? 'Expense updated' : 'Expense saved', res.cascade)
      onClose()
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
      title={existing ? 'Edit expense' : 'New expense'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={!unitId || !category.trim() || numOf(total) <= 0}>{existing ? 'Save changes' : 'Save expense'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fld label="Unit">
          <SearchableDropdown
            aria-label="Unit"
            value={unitId}
            onChange={(v) => setUnitId(v)}
            options={units}
            placeholder="Select unit…"
          />
        </Fld>
        <Fld label="Vendor (optional)">
          <SearchableDropdown
            aria-label="Vendor"
            value={vendorId}
            onChange={(v) => setVendorId(v)}
            options={vendors}
            placeholder="— none —"
          />
        </Fld>
        <Fld label="Category"><input className="input h-9" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Power, Freight, Rent…" /></Fld>
        <Fld label="Total payable (₹)"><input type="number" min={0} step="0.01" className="input h-9" value={total} onChange={(e) => setTotal(e.target.value)} /></Fld>
        <Fld label="Date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
        <Fld label="Due date (optional)"><input type="date" className="input h-9" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Fld>
      </div>
    </Drawer>
  )
}

function PayModal({ row, onClose }: { row: ExpenseRow; onClose: () => void }) {
  const [amount, setAmount] = useState('')
  const [mode, setMode] = useState<PaymentMode>('rtgs')
  const [ref, setRef] = useState('')
  const [date, setDate] = useState(todayISO())
  const [submitting, setSubmitting] = useState(false)

  function onSave() {
    setSubmitting(true)
    try {
      const res = runRecordExpensePayment({
        expenseId: row.expense.id,
        date,
        amountPaise: toPaise(numOf(amount)),
        mode,
        ref: ref.trim() || undefined,
      })
      toastCommandSuccess('Payment recorded', res.cascade)
      onClose()
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
      size="sm"
      title={`Pay ${row.expense.category}`}
      description={`Balance ${formatINRSymbol(row.balance)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={numOf(amount) <= 0}>Record payment</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fld label="Amount (₹)"><input type="number" min={0} step="0.01" className="input h-9" value={amount} onChange={(e) => setAmount(e.target.value)} /></Fld>
        <Fld label="Mode">
          <SearchableDropdown
            aria-label="Mode"
            value={mode}
            onChange={(v) => setMode(v as PaymentMode)}
            options={MODES.map((m) => ({ value: m, label: m.toUpperCase() }))}
          />
        </Fld>
        <Fld label="Ref"><input className="input h-9" value={ref} onChange={(e) => setRef(e.target.value)} /></Fld>
        <Fld label="Date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
      </div>
    </Drawer>
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
