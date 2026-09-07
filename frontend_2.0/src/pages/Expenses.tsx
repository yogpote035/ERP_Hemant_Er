import { useEffect, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { Banknote, Plus, IndianRupee, Pencil, Trash2, Download } from 'lucide-react'
import { formatINRSymbol, formatINRCompact, fromPaise, toPaise, type Paise } from '@/lib/money'
import { addDaysISO, formatDMY, todayISO } from '@/lib/date'
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
import { useEntryUnitContext } from '@/hooks/useEntryUnitContext'

const numOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
const STATUS_TONE: Record<ExpenseStatus, BadgeTone> = { unpaid: 'primary', partial: 'warning', overdue: 'danger', paid: 'success' }
const MODES: PaymentMode[] = ['rtgs', 'neft', 'cheque', 'upi', 'cash', 'bank']
const PAYMENT_MODE_OPTIONS = MODES.map((mode) => ({ value: mode, label: mode.toUpperCase() }))
const EXPENSE_COLUMNS = [
  { key: 'unit', label: 'Unit' }, { key: 'supplierName', label: 'Supplier Name' },
  { key: 'supplierGstin', label: 'Supplier GST Number' }, { key: 'hsnSac', label: 'SAC/HSN Code' },
  { key: 'supplierInvoiceNo', label: 'Supplier Invoice Number' }, { key: 'invoiceDate', label: 'Invoice Date' },
  { key: 'quantity', label: 'Quantity' }, { key: 'ratePerPc', label: 'Rate/Pc' },
  { key: 'subtotal', label: 'Subtotal' }, { key: 'cgstAmount', label: 'CGST' },
  { key: 'sgstAmount', label: 'SGST' }, { key: 'igstAmount', label: 'IGST' },
  { key: 'tcsAmount', label: 'TCS' }, { key: 'grandTotal', label: 'Grand Total' },
  { key: 'cgstPct', label: 'CGST (%)' }, { key: 'sgstPct', label: 'SGST (%)' },
  { key: 'igstPct', label: 'IGST (%)' }, { key: 'tcsPct', label: 'TCS (%)' },
  { key: 'paymentMode', label: 'Mode of Payment' }, { key: 'paymentDate', label: 'Payment Date' },
  { key: 'paidAmount', label: 'Paid Amount' }, { key: 'balance', label: 'Balance' },
]
const EXPENSE_SAMPLE = [{
  unit: 'HI', supplierName: 'ABC Industrial Supplies', supplierGstin: '27ABCDE1234F1Z5', hsnSac: '84669390',
  supplierInvoiceNo: 'ABC/2026-27/001', invoiceDate: '2026-09-07', quantity: 10, ratePerPc: 100,
  subtotal: 1000, cgstAmount: 90, sgstAmount: 90, igstAmount: 0, tcsAmount: 10,
  grandTotal: 1190, cgstPct: 9, sgstPct: 9, igstPct: 0, tcsPct: 1,
  paymentMode: 'NEFT', paymentDate: '2026-09-07', paidAmount: 500, balance: 690,
}]
const amount = (row: ImportedRow, label: string) => excelNumber(excelValue(row, label)) ?? 0
const expenseImportMath = (row: ImportedRow) => {
  const quantity = amount(row, 'Quantity'); const rate = amount(row, 'Rate/Pc')
  const subtotal = quantity * rate
  const cgstPct = amount(row, 'CGST (%)'); const sgstPct = amount(row, 'SGST (%)'); const igstPct = amount(row, 'IGST (%)'); const tcsPct = amount(row, 'TCS (%)')
  const cgst = subtotal * cgstPct / 100; const sgst = subtotal * sgstPct / 100; const igst = subtotal * igstPct / 100; const tcs = subtotal * tcsPct / 100
  return { quantity, rate, subtotal, cgstPct, sgstPct, igstPct, tcsPct, cgst, sgst, igst, tcs, total: subtotal + cgst + sgst + igst + tcs }
}

export default function Expenses() {
  const entryUnit = useEntryUnitContext()
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
    const state = useStore.getState(); const unitText=excelText(excelValue(row,'Unit')).toLowerCase(); const vendorText=excelText(excelValue(row,'Supplier Name')).toLowerCase(); const gstin=excelText(excelValue(row,'Supplier GST Number')).toLowerCase()
    const unit=values(state.masters.units).find((v)=>[v.id,v.code,v.name].some((k)=>k.toLowerCase()===unitText)); const vendor=values(state.masters.vendors).find((v)=>[v.id,v.code,v.name,v.gstin].filter(Boolean).some((k)=>String(k).toLowerCase()===vendorText || String(k).toLowerCase()===gstin)); return {unit,vendor}
  }
  const expenseKey = (row: ImportedRow) => { const {unit,vendor}=expenseRefs(row); return [unit?.id ?? '',vendor?.id ?? '',excelText(excelValue(row,'Supplier Invoice Number')),excelText(excelValue(row,'Invoice Date')),excelText(excelValue(row,'Grand Total'))].join('|').toLowerCase() }
  const existingExpenseKeys = new Set(rows.map(({ expense }) => [expense.unitId,expense.vendorId ?? '',expense.supplierInvoiceNo || expense.category,expense.date,String(fromPaise(expense.totalPaise))].join('|').toLowerCase()))
  const validateExpenseImport = (row: ImportedRow) => { const {unit,vendor}=expenseRefs(row); const math=expenseImportMath(row); const paid=amount(row,'Paid Amount'); if(!unit) return 'Unit does not exist or is not accessible'; if(!vendor) return 'Supplier does not exist (match by name or GST number)'; if(math.igstPct>0&&(math.cgstPct>0||math.sgstPct>0)) return 'Use either IGST or CGST + SGST'; if(paid>math.total) return 'Paid amount cannot exceed grand total'; const suppliedTotal=amount(row,'Grand Total'); if(suppliedTotal>0&&Math.abs(suppliedTotal-math.total)>0.01) return 'Grand Total does not match quantity, rate and tax percentages'; return undefined }

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
    const data = rows.map(({ expense, vendorName, paid, balance }) => ({
      unit: state.masters.units.byId[expense.unitId]?.code ?? expense.unitId,
      supplierName: vendorName, supplierGstin: state.masters.vendors.byId[expense.vendorId ?? '']?.gstin ?? '',
      hsnSac: expense.hsnSac ?? '', supplierInvoiceNo: expense.supplierInvoiceNo ?? '', invoiceDate: expense.date,
      quantity: expense.quantity ?? '', ratePerPc: expense.ratePaise != null ? fromPaise(expense.ratePaise) : '', subtotal: expense.subTotalPaise != null ? fromPaise(expense.subTotalPaise) : '',
      cgstAmount: expense.subTotalPaise != null ? fromPaise(Math.round(expense.subTotalPaise*(expense.cgstPct??0)/100) as Paise) : '', sgstAmount: expense.subTotalPaise != null ? fromPaise(Math.round(expense.subTotalPaise*(expense.sgstPct??0)/100) as Paise) : '',
      igstAmount: expense.subTotalPaise != null ? fromPaise(Math.round(expense.subTotalPaise*(expense.igstPct??0)/100) as Paise) : '', tcsAmount: expense.subTotalPaise != null ? fromPaise(Math.round(expense.subTotalPaise*(expense.tcsPct??0)/100) as Paise) : '',
      grandTotal: fromPaise(expense.totalPaise), cgstPct: expense.cgstPct ?? '', sgstPct: expense.sgstPct ?? '', igstPct: expense.igstPct ?? '', tcsPct: expense.tcsPct ?? '',
      paymentMode: expense.instalments.at(-1)?.mode?.toUpperCase() ?? '', paymentDate: expense.instalments.at(-1)?.date ?? '', paidAmount: fromPaise(paid), balance: fromPaise(balance),
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
      const supplierText=excelText(excelValue(row,'Supplier Name')).toLowerCase(); const gstin=excelText(excelValue(row,'Supplier GST Number')).toLowerCase()
      const vendor = vendorsByKey.get(supplierText) ?? values(state.masters.vendors).find((v)=>v.gstin?.toLowerCase()===gstin)
      const date = excelText(excelValue(row, 'Invoice Date')) || todayISO(); const math=expenseImportMath(row); const paid=amount(row,'Paid Amount'); const mode=excelText(excelValue(row,'Mode of Payment')).toLowerCase() as PaymentMode
      if (!unit || !vendor) throw new Error(`Row ${index + 2}: Unit and Supplier must match existing records`)
      return {
        unitId: unit.id, vendorId: vendor.id, category: excelText(excelValue(row,'SAC/HSN Code')) || 'Expense', date, totalPaise: toPaise(math.total),
        supplierInvoiceNo: excelText(excelValue(row, 'Supplier Invoice Number')) || undefined, hsnSac: excelText(excelValue(row, 'SAC/HSN Code')) || undefined,
        quantity: math.quantity || undefined, ratePaise: math.rate ? toPaise(math.rate) : undefined, subTotalPaise: math.subtotal ? toPaise(math.subtotal) : undefined,
        igstPct: math.igstPct || undefined, cgstPct: math.cgstPct || undefined, sgstPct: math.sgstPct || undefined, tcsPct: math.tcsPct || undefined,
        instalments: paid > 0 ? [{ date: excelText(excelValue(row,'Payment Date')) || date, amountPaise: toPaise(paid), mode: MODES.includes(mode) ? mode : 'bank' }] : undefined,
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
        {can('expenses', 'create') ? <ExcelImportButton size="md" title="Import expenses" columns={EXPENSE_COLUMNS} existingKeys={existingExpenseKeys} rowKey={expenseKey} validateRow={validateExpenseImport} onRows={importExpenses} prefill={entryUnit.preferredUnitId ? { unit: entryUnit.preferredUnitId } : undefined} contextMessage={entryUnit.message} sampleRows={EXPENSE_SAMPLE} sampleFilename="expense-import-sample.xlsx" /> : null}
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

      {creating ? <ExpenseForm units={units} defaultUnitId={entryUnit.preferredUnitId} unitMessage={entryUnit.message} onClose={() => { setCreating(false); bumpRefresh() }} /> : null}
      {editing ? <ExpenseForm units={units} existing={editing} defaultUnitId={entryUnit.preferredUnitId} unitMessage={entryUnit.message} onClose={() => { setEditing(null); bumpRefresh() }} /> : null}
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
  defaultUnitId,
  unitMessage,
  existing,
  onClose,
}: {
  units: { value: string; label: string }[]
  defaultUnitId?: string
  unitMessage?: string
  existing?: Expense
  onClose: () => void
}) {
  const [unitId, setUnitId] = useState(existing?.unitId ?? defaultUnitId ?? '')
  useEffect(() => {
    if (defaultUnitId && ((!existing && !unitId) || (existing && !unitMessage))) setUnitId(defaultUnitId)
  }, [defaultUnitId, existing, unitId, unitMessage])
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
  const [dueDate, setDueDate] = useState(existing?.dueDate ?? addDaysISO(existing?.date ?? todayISO(), 45))
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
          <Fld label="Unit" hint={!existing ? unitMessage : undefined}>
            <SearchableDropdown aria-label="Unit" value={unitId} disabled={Boolean(defaultUnitId) && !unitMessage} onChange={(v) => { setUnitId(v); setVendorId('') }} options={units} placeholder="Select unit…" />
          </Fld>
          <Fld label="Supplier name">
            <SearchableDropdown aria-label="Supplier name" value={vendorId} onChange={(v) => setVendorId(v)} options={vendors} placeholder={unitId ? 'Select supplier…' : 'Select unit first…'} />
          </Fld>
          <Fld label="Supplier GSTIN"><input readOnly className="input h-9 bg-muted mono text-muted-fg" value={supplier?.gstin ?? ''} placeholder="Loaded from supplier" /></Fld>
          <Fld label="Supplier invoice number"><input className="input h-9 mono" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} placeholder="Supplier's bill no." /></Fld>
          <Fld label="Invoice date"><input type="date" className="input h-9" value={date} onChange={(e) => { const next = e.target.value; setDate(next); setDueDate(addDaysISO(next, 45)) }} /></Fld>
          <Fld label="SAC / HSN code"><input className="input h-9 mono" value={hsnSac} onChange={(e) => setHsnSac(e.target.value)} placeholder="e.g. 27101990" /></Fld>
          <Fld label="Quantity"><input type="number" min={0} step="any" className="input h-9" value={quantity} onChange={(e) => setQuantity(e.target.value)} /></Fld>
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
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fld label="CGST"><Computed value={cgstAmt} /></Fld>
          <Fld label="SGST"><Computed value={sgstAmt} /></Fld>
          <Fld label="IGST"><Computed value={igstAmt} /></Fld>
          <Fld label="TCS"><Computed value={tcsAmt} /></Fld>
        </div>
        {gstTotal > 0 ? (
          <p className="text-[12px] text-muted-fg" aria-live="polite">
            IGST {formatINRSymbol(igstAmt)} · CGST {formatINRSymbol(cgstAmt)} · SGST {formatINRSymbol(sgstAmt)} · TCS {formatINRSymbol(tcsAmt)}
            {' '}= <b className="text-fg">GST {formatINRSymbol(gstTotal)}</b>
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Fld label="Grand total"><Computed value={totalPaise} strong /></Fld>
          <Fld label="Due date (45 days)"><input type="date" className="input h-9" value={dueDate} onChange={(e) => setDueDate(e.target.value)} /></Fld>
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

function Fld({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-fg">{label}</span>
      {children}
      {hint ? <span className="text-[11px] text-warning">{hint}</span> : null}
    </label>
  )
}
