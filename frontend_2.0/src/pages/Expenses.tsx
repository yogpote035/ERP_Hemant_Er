import { useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Banknote, Plus, IndianRupee, Pencil, Trash2, Download } from 'lucide-react'
import { formatINRSymbol, formatINRCompact, fromPaise, toPaise, type Paise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import type { Expense, PaymentMode } from '@/types/domain'
import { useStore } from '@/store'
import { unitOptions, vendorOptionsForUnit } from '@/masters/options'
import { runSaveExpense, runRecordExpensePayment, runDeleteExpense } from '@/store/expenseCommands'
import { selectExpenseRows, selectVendorOutstanding, type ExpenseRow, type ExpenseStatus } from '@/selectors/finance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { ActionMenu, Badge, Button, Card, ConfirmDialog, Drawer, EmptyState, Kpi, KpiGrid, SearchableDropdown, TablePager, type ActionMenuItem, type BadgeTone } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'
import { values } from '@/store/normalized'
import { exportRowsToXlsx } from '@/lib/exportXlsx'
import { excelNumber, excelText, excelValue, type ImportedRow } from '@/lib/importXlsx'
import { ExcelImportButton } from '@/components/ExcelImportButton'
import { toast } from 'sonner'

const numOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const STATUS_TONE: Record<ExpenseStatus, BadgeTone> = { unpaid: 'primary', partial: 'warning', overdue: 'danger', paid: 'success' }
const MODES: PaymentMode[] = ['rtgs', 'neft', 'cheque', 'upi', 'cash', 'bank']
const PAYMENT_MODE_OPTIONS = MODES.map((mode) => ({ value: mode, label: mode.toUpperCase() }))
const EXPENSE_COLUMNS = [
  { key: 'unit', label: 'Unit', required: true }, { key: 'vendor', label: 'Vendor', required: true },
  { key: 'category', label: 'Category', required: true }, { key: 'description', label: 'Description' },
  { key: 'date', label: 'Date', required: true }, { key: 'dueDate', label: 'Due Date' },
  { key: 'supplierInvoiceNo', label: 'Supplier Invoice No' }, { key: 'hsnSac', label: 'HSN/SAC' },
  { key: 'quantity', label: 'Quantity' }, { key: 'rate', label: 'Rate' },
  { key: 'subtotal', label: 'Subtotal' }, { key: 'igst', label: 'IGST %' },
  { key: 'cgst', label: 'CGST %' }, { key: 'sgst', label: 'SGST %' },
  { key: 'tcs', label: 'TCS %' }, { key: 'total', label: 'Total', required: true },
  { key: 'paid', label: 'Paid' }, { key: 'balance', label: 'Balance' }, { key: 'status', label: 'Status' },
]

export default function Expenses() {
  const can = useCan()
  const units = useStore(unitOptions)
  const rows = useStore(useShallow(selectExpenseRows))
  const vendorOut = useStore(useShallow(selectVendorOutstanding))
  const totalPaid = rows.reduce((a, r) => a + r.paid, 0)
  const outstanding = rows.reduce((a, r) => a + r.balance, 0)
  const overdueAmt = rows.reduce((a, r) => a + (r.status === 'overdue' ? r.balance : 0), 0)
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<Expense | null>(null)
  const [paying, setPaying] = useState<ExpenseRow | null>(null)
  const [deleting, setDeleting] = useState<Expense | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  // Server-driven table in API mode; bump after a write so the fetched page reflects it.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)
  const paged = usePagedSource({
    localRows: rows,
    endpoint: '/expenses',
    searchText: (r) => `${r.expense.category ?? ''} ${r.expense.description ?? ''} ${r.vendorName ?? ''}`,
    pageSize: 25,
    refreshKey,
    // GET /expenses returns a FLAT row ({ ...expense, vendorName, paidPaise, ... }); the
    // table renders the nested selector shape, so re-nest it here.
    mapApiRow: (raw): ExpenseRow => {
      const e = raw as Expense & { vendorName?: string; paidPaise: Paise; balancePaise: Paise; status: ExpenseStatus }
      return { expense: e, vendorName: e.vendorName ?? '—', paid: e.paidPaise, balance: e.balancePaise, status: e.status }
    },
  })
  const expenseRefs = (row: ImportedRow) => {
    const state = useStore.getState(); const unitText=excelText(excelValue(row,'Unit')).toLowerCase(); const vendorText=excelText(excelValue(row,'Vendor')).toLowerCase()
    const unit=values(state.masters.units).find((v)=>[v.id,v.code,v.name].some((k)=>k.toLowerCase()===unitText)); const vendor=values(state.masters.vendors).find((v)=>[v.id,v.code,v.name].some((k)=>k.toLowerCase()===vendorText)); return {unit,vendor}
  }
  const expenseKey = (row: ImportedRow) => { const {unit,vendor}=expenseRefs(row); return [unit?.id ?? '',vendor?.id ?? '',excelText(excelValue(row,'Supplier Invoice No'))||excelText(excelValue(row,'Category')),excelText(excelValue(row,'Date')),excelText(excelValue(row,'Total'))].join('|').toLowerCase() }
  const existingExpenseKeys = new Set(rows.map(({ expense }) => [expense.unitId,expense.vendorId ?? '',expense.supplierInvoiceNo || expense.category,expense.date,String(fromPaise(expense.totalPaise))].join('|').toLowerCase()))
  const validateExpenseImport = (row: ImportedRow) => { const {unit,vendor}=expenseRefs(row); if(!unit) return 'Unit does not exist or is not accessible'; if(!vendor) return 'Vendor does not exist'; if(!(excelNumber(excelValue(row,'Total'))! > 0)) return 'Total must be greater than zero'; return undefined }

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteExpense(deleting.id)
      toastCommandSuccess('Expense deleted', res.cascade)
      setDeleting(null)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  async function exportExpenses() {
    if (rows.length === 0) { toast.error('No expenses to export'); return }
    const state = useStore.getState()
    const data = rows.map(({ expense, vendorName, paid, balance, status }) => ({
      unit: state.masters.units.byId[expense.unitId]?.code ?? expense.unitId,
      vendor: state.masters.vendors.byId[expense.vendorId ?? '']?.code ?? vendorName,
      category: expense.category, description: expense.description ?? '', date: expense.date, dueDate: expense.dueDate ?? '',
      supplierInvoiceNo: expense.supplierInvoiceNo ?? '', hsnSac: expense.hsnSac ?? '', quantity: expense.quantity ?? '',
      rate: expense.ratePaise != null ? fromPaise(expense.ratePaise) : '', subtotal: expense.subTotalPaise != null ? fromPaise(expense.subTotalPaise) : '',
      igst: expense.igstPct ?? '', cgst: expense.cgstPct ?? '', sgst: expense.sgstPct ?? '', tcs: expense.tcsPct ?? '',
      total: fromPaise(expense.totalPaise), paid: fromPaise(paid), balance: fromPaise(balance), status,
    }))
    await exportRowsToXlsx(`expenses-${todayISO()}.xlsx`, 'Expenses', EXPENSE_COLUMNS, data)
    toast.success(`Exported ${data.length} expenses`)
  }

  async function importExpenses(imported: ImportedRow[]) {
    const state = useStore.getState()
    const unitsByKey = new Map(values(state.masters.units).flatMap((unit) => [[unit.id.toLowerCase(), unit], [unit.code.toLowerCase(), unit], [unit.name.toLowerCase(), unit]]))
    const vendorsByKey = new Map(values(state.masters.vendors).flatMap((vendor) => [[vendor.id.toLowerCase(), vendor], [vendor.code.toLowerCase(), vendor], [vendor.name.toLowerCase(), vendor]]))
    const inputs = imported.map((row, index) => {
      const unit = unitsByKey.get(excelText(excelValue(row, 'Unit')).toLowerCase())
      const vendor = vendorsByKey.get(excelText(excelValue(row, 'Vendor')).toLowerCase())
      const category = excelText(excelValue(row, 'Category'))
      const date = excelText(excelValue(row, 'Date'))
      const total = excelNumber(excelValue(row, 'Total'))
      if (!unit || !vendor || !category || !date || !total) throw new Error(`Row ${index + 2}: Unit, Vendor, Category, Date and Total are required`)
      return {
        unitId: unit.id, vendorId: vendor.id, category, date, totalPaise: toPaise(total),
        description: excelText(excelValue(row, 'Description')) || undefined,
        dueDate: excelText(excelValue(row, 'Due Date')) || undefined,
        supplierInvoiceNo: excelText(excelValue(row, 'Supplier Invoice No')) || undefined,
        hsnSac: excelText(excelValue(row, 'HSN/SAC')) || undefined,
        quantity: excelNumber(excelValue(row, 'Quantity')),
        ratePaise: excelNumber(excelValue(row, 'Rate')) != null ? toPaise(excelNumber(excelValue(row, 'Rate'))!) : undefined,
        subTotalPaise: excelNumber(excelValue(row, 'Subtotal')) != null ? toPaise(excelNumber(excelValue(row, 'Subtotal'))!) : undefined,
        igstPct: excelNumber(excelValue(row, 'IGST %')), cgstPct: excelNumber(excelValue(row, 'CGST %')),
        sgstPct: excelNumber(excelValue(row, 'SGST %')), tcsPct: excelNumber(excelValue(row, 'TCS %')),
      }
    })
    for (const input of inputs) runSaveExpense(input)
    toast.success(`Imported ${inputs.length} expenses`)
    bumpRefresh()
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Expense Tracker</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Outstanding balances, payment schedules and vendor-wise dues.</p>
        </div>
        <input
          className="input h-9 w-56 ml-auto"
          placeholder="Search…"
          aria-label="Search"
          value={paged.search}
          onChange={(e) => paged.setSearch(e.target.value)}
        />
        <Button className="w-24 shrink-0 justify-center" variant="secondary" leftIcon={<Download size={15} />} onClick={exportExpenses}>Export</Button>
        {can('expenses', 'create') ? <ExcelImportButton size="md" title="Import expenses" columns={EXPENSE_COLUMNS} existingKeys={existingExpenseKeys} rowKey={expenseKey} validateRow={validateExpenseImport} onRows={importExpenses} /> : null}
        {can('expenses', 'create') ? (
          <Button leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>Record Expense</Button>
        ) : null}
      </div>

      <KpiGrid>
        <Kpi tone="green" label="Total Paid" value={formatINRCompact(totalPaid as Paise)} sub="across expenses" />
        <Kpi tone="amber" label="Outstanding Dues" value={formatINRCompact(outstanding as Paise)} sub="to pay" />
        <Kpi tone="red" label="Overdue" value={formatINRCompact(overdueAmt as Paise)} sub="past due date" />
        <Kpi tone="blue" label="Suppliers w/ Dues" value={vendorOut.length} sub="with a balance" />
      </KpiGrid>

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
                <th scope="col" className="px-3 py-2.5 font-semibold">Description</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Vendor</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Paid</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Balance</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Status</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr key={r.expense.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.expense.date)}</td>
                  <td className="px-3 py-2.5">{r.expense.category}</td>
                  <td className="px-3 py-2.5">{r.vendorName}</td>
                  <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(r.expense.totalPaise)}</td>
                  <td className="px-3 py-2.5 text-right mono text-muted-fg">{formatINRSymbol(r.paid)}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.balance)}</td>
                  <td className="px-3 py-2.5"><Badge tone={STATUS_TONE[r.status]} className="capitalize">{r.status}</Badge></td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end">
                      <ActionMenu
                        label={`Actions for ${r.expense.category}`}
                        items={[
                          ...(can('expenses', 'edit') && r.balance > 0 ? [{ key: 'pay', label: 'Record payment', icon: <IndianRupee />, onClick: () => setPaying(r) }] : []),
                          ...(can('expenses', 'edit') ? [{ key: 'edit', label: 'Edit expense', icon: <Pencil />, onClick: () => setEditing(r.expense) }] : []),
                          ...(can('expenses', 'delete') ? [{ key: 'delete', label: 'Delete expense', icon: <Trash2 />, onClick: () => setDeleting(r.expense), danger: true }] : []),
                        ] as ActionMenuItem[]}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
        </Card>
      )}

      {creating ? <ExpenseForm units={units} onClose={() => { setCreating(false); bumpRefresh() }} /> : null}
      {editing ? <ExpenseForm units={units} existing={editing} onClose={() => { setEditing(null); bumpRefresh() }} /> : null}
      {paying ? <PayModal row={paying} onClose={() => { setPaying(null); bumpRefresh() }} /> : null}
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
  existing,
  onClose,
}: {
  units: { value: string; label: string }[]
  existing?: Expense
  onClose: () => void
}) {
  const [unitId, setUnitId] = useState(existing?.unitId ?? '')
  const [vendorId, setVendorId] = useState(existing?.vendorId ?? '')
  const vendors = useStore(vendorOptionsForUnit(unitId))
  // "Description" is the renamed Category field — stored on expense.category.
  const [description, setDescription] = useState(existing?.category ?? '')
  const [hsnSac, setHsnSac] = useState(existing?.hsnSac ?? '')
  // Legacy expenses carry only a total → seed qty 1 × rate(total) so they round-trip.
  const [quantity, setQuantity] = useState(
    existing?.quantity != null ? String(existing.quantity) : existing ? '1' : ''
  )
  const [rate, setRate] = useState(
    existing?.ratePaise != null
      ? String(fromPaise(existing.ratePaise))
      : existing
        ? String(fromPaise(existing.totalPaise))
        : ''
  )
  const [igstPct, setIgstPct] = useState(existing?.igstPct != null ? String(existing.igstPct) : '')
  const [cgstPct, setCgstPct] = useState(existing?.cgstPct != null ? String(existing.cgstPct) : '')
  const [sgstPct, setSgstPct] = useState(existing?.sgstPct != null ? String(existing.sgstPct) : '')
  const [tcsPct, setTcsPct] = useState(existing?.tcsPct != null ? String(existing.tcsPct) : '')
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState(existing?.supplierInvoiceNo ?? '')
  const [date, setDate] = useState(existing?.date ?? todayISO())
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? '')
  const [paymentMode, setPaymentMode] = useState<PaymentMode>('bank')
  const [paymentDate, setPaymentDate] = useState(todayISO())
  const [paymentAmount, setPaymentAmount] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const supplier = useStore((s) => vendorId ? s.masters.vendors.byId[vendorId] : undefined)

  // Live math: Sub Total = Qty × Rate; each GST/TCS % applies to the sub total;
  // Total Amount = Sub Total + all taxes. Sub Total and Total are read-only.
  const qtyNum = numOf(quantity)
  const ratePaise = toPaise(numOf(rate))
  const subTotalPaise = Math.round(qtyNum * ratePaise) as Paise
  const pctAmt = (p: string) => Math.round(subTotalPaise * (numOf(p) / 100)) as Paise
  const igstAmt = pctAmt(igstPct)
  const cgstAmt = pctAmt(cgstPct)
  const sgstAmt = pctAmt(sgstPct)
  const tcsAmt = pctAmt(tcsPct)
  const gstTotal = (igstAmt + cgstAmt + sgstAmt + tcsAmt) as Paise
  const totalPaise = (subTotalPaise + gstTotal) as Paise
  const existingPaidPaise = (existing?.instalments ?? []).reduce((sum, p) => (sum + p.amountPaise) as Paise, 0 as Paise)
  const paymentPaise = existing ? existingPaidPaise : toPaise(numOf(paymentAmount))
  const balancePaise = Math.max(0, totalPaise - paymentPaise) as Paise

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveExpense({
        id: existing?.id,
        unitId,
        vendorId: vendorId || undefined,
        category: description.trim(),
        date,
        dueDate: dueDate || undefined,
        hsnSac: hsnSac.trim() || undefined,
        quantity: qtyNum > 0 ? qtyNum : undefined,
        ratePaise: ratePaise > 0 ? ratePaise : undefined,
        subTotalPaise: subTotalPaise > 0 ? subTotalPaise : undefined,
        igstPct: numOf(igstPct) || undefined,
        cgstPct: numOf(cgstPct) || undefined,
        sgstPct: numOf(sgstPct) || undefined,
        tcsPct: numOf(tcsPct) || undefined,
        supplierInvoiceNo: supplierInvoiceNo.trim() || undefined,
        totalPaise,
        instalments: !existing && paymentPaise > 0 ? [{ date: paymentDate, amountPaise: paymentPaise, mode: paymentMode }] : undefined,
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
      size="lg"
      title={existing ? 'Edit expense' : 'New expense'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={!unitId || (!existing && !vendorId) || !description.trim() || (!existing && !supplierInvoiceNo.trim()) || totalPaise <= 0 || paymentPaise > totalPaise}>{existing ? 'Save changes' : 'Save expense'}</Button>
        </>
      }
    >
      <div className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fld label="Unit">
            <SearchableDropdown aria-label="Unit" value={unitId} onChange={(v) => { setUnitId(v); setVendorId('') }} options={units} placeholder="Select unit…" />
          </Fld>
          <Fld label="Supplier name">
            <SearchableDropdown aria-label="Supplier name" value={vendorId} onChange={(v) => setVendorId(v)} options={vendors} placeholder={unitId ? 'Select supplier…' : 'Select unit first…'} />
          </Fld>
          <Fld label="Supplier GSTIN"><input readOnly className="input h-9 bg-muted mono text-muted-fg" value={supplier?.gstin ?? ''} placeholder="Loaded from supplier" /></Fld>
          <Fld label="Supplier invoice number"><input className="input h-9 mono" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Supplier's bill no." /></Fld>
          <Fld label="Invoice date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
          <Fld label="SAC / HSN code"><input className="input h-9 mono" value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} placeholder="e.g. 27101990" /></Fld>
          <Fld label="Qty"><input type="number" min={0} step="any" className="input h-9" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Fld>
          <Fld label="Rate / pc (₹)"><input type="number" min={0} step="0.01" className="input h-9" value={rate} onChange={(e) => setRate(e.target.value)} /></Fld>
          <Fld label="Subtotal"><Computed value={subTotalPaise} /></Fld>
          <Fld label="Description"><input className="input h-9" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Item / service description" /></Fld>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fld label={`CGST % · ${formatINRSymbol(cgstAmt)}`}><input type="number" min={0} max={100} step="0.01" className="input h-9" value={cgstPct} onChange={(e) => setCgstPct(e.target.value)} /></Fld>
          <Fld label={`SGST % · ${formatINRSymbol(sgstAmt)}`}><input type="number" min={0} max={100} step="0.01" className="input h-9" value={sgstPct} onChange={(e) => setSgstPct(e.target.value)} /></Fld>
          <Fld label={`IGST % · ${formatINRSymbol(igstAmt)}`}><input type="number" min={0} max={100} step="0.01" className="input h-9" value={igstPct} onChange={(e) => setIgstPct(e.target.value)} /></Fld>
          <Fld label={`TCS % · ${formatINRSymbol(tcsAmt)}`}><input type="number" min={0} max={100} step="0.01" className="input h-9" value={tcsPct} onChange={(e) => setTcsPct(e.target.value)} /></Fld>
        </div>
        {gstTotal > 0 ? (
          <p className="text-[12px] text-muted-fg" aria-live="polite">
            IGST {formatINRSymbol(igstAmt)} · CGST {formatINRSymbol(cgstAmt)} · SGST {formatINRSymbol(sgstAmt)} · TCS {formatINRSymbol(tcsAmt)}
            {' '}= <b className="text-fg">GST {formatINRSymbol(gstTotal)}</b>
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fld label="Grand total"><Computed value={totalPaise} strong /></Fld>
          <Fld label="Due date (optional)"><input type="date" className="input h-9" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Fld>
          <Fld label="Mode of payment">
            <SearchableDropdown
              aria-label="Mode of payment"
              value={paymentMode}
              onChange={(value) => setPaymentMode(value as PaymentMode)}
              options={PAYMENT_MODE_OPTIONS}
              searchable={false}
              disabled={Boolean(existing)}
            />
          </Fld>
          <Fld label="Payment date"><input type="date" className="input h-9" value={existing?.instalments.at(-1)?.date ?? paymentDate} onChange={(e) => setPaymentDate(e.target.value)} disabled={Boolean(existing)} /></Fld>
          <Fld label="Payment amount"><input type="number" min={0} max={fromPaise(totalPaise)} step="0.01" className="input h-9" value={existing ? fromPaise(existingPaidPaise) : paymentAmount} onChange={(e) => setPaymentAmount(e.target.value)} disabled={Boolean(existing)} /></Fld>
          <Fld label="Balance"><Computed value={balancePaise} strong /></Fld>
        </div>
        {paymentPaise > totalPaise ? <p className="text-[12px] text-danger">Payment amount cannot exceed the grand total.</p> : null}
      </div>
    </Drawer>
  )
}

/** Read-only derived amount (Sub Total / Total Amount) — muted, right-aligned, mono. */
function Computed({ value, strong }: { value: Paise; strong?: boolean }) {
  return (
    <div
      className={`flex h-9 items-center justify-end rounded-md border border-border bg-muted px-3 mono text-[13px] ${strong ? 'font-semibold text-fg' : 'text-muted-fg'}`}
      aria-live="polite"
    >
      {formatINRSymbol(value)}
    </div>
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
            options={PAYMENT_MODE_OPTIONS}
            searchable={false}
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
