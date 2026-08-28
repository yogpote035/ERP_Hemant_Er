import { useState, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CalendarClock, ListPlus, Pencil, Trash2, X } from 'lucide-react'
import { formatINRSymbol, fromPaise, mulQty, type Paise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import type { Id, ProductionAttendance, ShiftAttendance } from '@/types/domain'
import { useStore } from '@/store'
import {
  operationOptions,
  partOptionsForUnit,
  machineOptionsForUnit,
  employeeOptionsWritable,
} from '@/masters/options'
import {
  runSaveProductionAttendance,
  runSaveShiftAttendance,
  runDeleteProductionAttendance,
  runDeleteShiftAttendance,
  type ProductionInput,
  type ShiftInput,
} from '@/store/attendanceCommands'
import {
  selectProductionRows,
  selectShiftRows,
  selectEarningsBetween,
  latestProductionRate,
  lastProductionClosingCounter,
  minutesBetween,
} from '@/selectors/attendance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, ConfirmDialog, EmptyState, SearchableDropdown, TablePager, Tabs } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'
import { attendanceApi } from '@/api/modules'
import { refreshAllData } from '@/api/refresh'

type TabKey = 'production' | 'shift' | 'earnings'
const TABS = [
  { value: 'production', label: 'Production' },
  { value: 'shift', label: 'Shift' },
  { value: 'earnings', label: 'Earnings' },
] as const

/** Shift labels shared by both attendance methods. */
const SHIFT_OPTIONS = [
  { value: '1', label: 'Shift 1' },
  { value: '2', label: 'Shift 2' },
  { value: '3', label: 'Shift 3' },
  { value: 'A', label: 'Shift A' },
  { value: 'B', label: 'Shift B' },
  { value: 'C', label: 'Shift C' },
  { value: 'G', label: 'General' },
]

const intOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
}

interface QueuedProduction {
  key: string
  input: Omit<ProductionInput, 'id'>
  employee: string
  machine: string
  part: string
  operation: string
  rate: Paise
}
interface QueuedShift {
  key: string
  input: Omit<ShiftInput, 'id'>
  employee: string
  rate: Paise
  hours: number
  wage: Paise
}
/** Minutes → "1h 05m" / "45m". */
function fmtMins(mins: number): string {
  if (mins <= 0) return '—'
  const h = Math.floor(mins / 60)
  const m = mins % 60
  return h ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

export default function Attendance() {
  const [tab, setTab] = useState<TabKey>('production')
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Attendance &amp; payroll</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">Production-based and shift-based labour, with derived earnings.</p>
      </div>
      <Tabs items={TABS} value={tab} onChange={setTab} ariaLabel="Attendance method" />
      {tab === 'production' ? <ProductionTab /> : tab === 'shift' ? <ShiftTab /> : <EarningsTab />}
    </div>
  )
}

function ProductionTab() {
  const can = useCan()
  const canCreate = can('attendance', 'create')
  const canEdit = can('attendance', 'edit')
  const canDelete = can('attendance', 'delete')
  const operations = useStore(operationOptions)
  const rows = useStore(useShallow(selectProductionRows))
  // Employees span every writable unit; the picked employee fixes the unit.
  const employees = useStore(useShallow(employeeOptionsWritable('production')))
  const empById = useStore((s) => s.masters.employees.byId)
  const machineById = useStore((s) => s.masters.machines.byId)
  const partById = useStore((s) => s.masters.parts.byId)

  const [editingId, setEditingId] = useState<Id | null>(null)
  const [deleting, setDeleting] = useState<ProductionAttendance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [date, setDate] = useState(todayISO())
  const [shiftNo, setShiftNo] = useState('1')
  const [employeeId, setEmployeeId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [partId, setPartId] = useState('')
  const [operationId, setOperationId] = useState('')

  // Unit is derived from the employee — machine & part pickers follow it.
  const unitId = employeeId ? empById[employeeId]?.unitId ?? '' : ''
  const parts = useStore(useShallow(partOptionsForUnit(unitId)))
  const machines = useStore(useShallow(machineOptionsForUnit(unitId)))
  // Changing the employee (and thus unit) clears the machine + part pickers, since
  // they belong to a unit. An edit-load sets the employee programmatically and must
  // KEEP the row's machine/part, so it raises this flag to skip the next clear.
  const skipUnitClear = useRef(false)
  useEffect(() => {
    if (skipUnitClear.current) {
      skipUnitClear.current = false
      return
    }
    setMachineId('')
    setPartId('')
  }, [unitId])

  const [standard, setStandard] = useState('')
  const [plan, setPlan] = useState('')
  const [totalMake, setTotalMake] = useState('')
  const [okQty, setOkQty] = useState('')
  const [scrap, setScrap] = useState('')
  const [rework, setRework] = useState('')
  const [mf, setMf] = useState('')
  const [dtFrom, setDtFrom] = useState('')
  const [dtTo, setDtTo] = useState('')
  const [remark, setRemark] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [queued, setQueued] = useState<QueuedProduction[]>([])
  const [batchErrors, setBatchErrors] = useState<Record<string, Record<string, string>>>({})

  // Total Make defaults to Closing − Opening (SRS FR-AT03); a typed value overrides it.
  const autoMake = Math.max(0, intOf(plan) - intOf(standard))
  const make = totalMake.trim() !== '' ? intOf(totalMake) : autoMake
  const breakdown = intOf(okQty) + intOf(scrap) + intOf(rework) + intOf(mf)
  const overBreakdown = breakdown > make
  const downtime = dtFrom && dtTo ? minutesBetween(dtFrom, dtTo) : 0
  // Reactive: re-fetches if a production rate is edited while the form is open.
  const rate = useStore((s) =>
    partId ? latestProductionRate(s, partId, machineId || undefined, operationId || undefined, date) : undefined
  )
  // Auto-fetch the next Standard counter (= last Plan + 1) for this machine + part.
  const lastClosing = useStore((s) =>
    machineId && partId ? lastProductionClosingCounter(s, machineId, partId, editingId ?? undefined) : null
  )
  // Seed the Standard counter when a (machine, part) is picked for a NEW entry; the
  // user can still overwrite it or hit Reset. Re-seeds when the latest entry changes.
  useEffect(() => {
    if (editingId || !machineId || !partId) return
    setStandard(lastClosing != null ? String(lastClosing + 1) : '0')
  }, [machineId, partId, editingId, lastClosing])
  const earned = rate != null ? mulQty(rate, intOf(okQty)) : (0 as Paise)

  // Why is "Save production" disabled? Surface it instead of a silently greyed button.
  const blockReason =
    !employeeId || !machineId || !partId ? 'Select employee, machine and part'
    : rate == null ? 'No production rate is configured for this part — add one under Rates first'
    : make <= 0 ? 'Enter the Standard/Plan counters (or a Total make qty)'
    : overBreakdown ? 'OK + Scrap + Rework + MF exceeds the total made'
    : (editingId ? !canEdit : !canCreate) ? "You don't have permission to save here"
    : null

  // Server-driven table in API mode; bump after a write so the fetched page reflects it.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)
  const paged = usePagedSource({
    localRows: rows,
    endpoint: '/attendance/production',
    searchText: (r) => `${r.employeeName ?? ''} ${r.partNo ?? ''}`,
    pageSize: 25,
    refreshKey,
  })

  function resetForm() {
    setEditingId(null)
    setShiftNo('A')
    setEmployeeId('')
    setMachineId('')
    setPartId('')
    setOperationId('')
    setStandard('')
    setPlan('')
    setTotalMake('')
    setOkQty('')
    setScrap('')
    setRework('')
    setMf('')
    setDtFrom('')
    setDtTo('')
    setRemark('')
  }

  function startEdit(entry: ProductionAttendance) {
    // If the employee's unit differs from the current one, the unitId effect will
    // fire and would wipe the machine/part we're about to load — tell it to skip once.
    const targetUnit = empById[entry.employeeId]?.unitId ?? ''
    if (targetUnit !== unitId) skipUnitClear.current = true
    setEditingId(entry.id)
    setDate(entry.date)
    setShiftNo(entry.shiftNo ?? '')
    setEmployeeId(entry.employeeId)
    setMachineId(entry.machineId)
    setPartId(entry.partId)
    setOperationId(entry.operationId ?? '')
    setStandard(String(entry.openingCounter))
    setPlan(String(entry.closingCounter))
    setTotalMake(String(entry.totalMakeQty))
    setOkQty(String(entry.okQty))
    setScrap(entry.scrapQty != null ? String(entry.scrapQty) : '')
    setRework(entry.reworkQty != null ? String(entry.reworkQty) : '')
    setMf(entry.mfQty != null ? String(entry.mfQty) : '')
    setDtFrom(entry.downtimeFrom ?? '')
    setDtTo(entry.downtimeTo ?? '')
    setRemark(entry.remark ?? '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteProductionAttendance(deleting.id)
      toastCommandSuccess('Production entry deleted', res.cascade)
      if (editingId === deleting.id) resetForm()
      setDeleting(null)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveProductionAttendance({
        id: editingId ?? undefined,
        unitId,
        date,
        shiftNo: shiftNo || undefined,
        employeeId,
        machineId,
        partId,
        operationId: operationId || undefined,
        standard: intOf(standard),
        plan: intOf(plan),
        totalMakeQty: make,
        okQty: intOf(okQty),
        scrapQty: intOf(scrap) || undefined,
        reworkQty: intOf(rework) || undefined,
        mfQty: intOf(mf) || undefined,
        downtimeFrom: dtFrom || undefined,
        downtimeTo: dtTo || undefined,
        remark: remark.trim() || undefined,
      })
      toastCommandSuccess(editingId ? 'Production updated' : 'Production saved', res.cascade)
      bumpRefresh()
      if (editingId) {
        resetForm()
      } else {
        // Keep the operator/machine/part for fast repeat entry; clear the counts.
        setTotalMake('')
        setOkQty('')
        setScrap('')
        setRework('')
        setMf('')
        setDtFrom('')
        setDtTo('')
        setRemark('')
      }
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  function currentInput(): Omit<ProductionInput, 'id'> {
    return {
      unitId, date, shiftNo: shiftNo || undefined, employeeId, machineId, partId,
      operationId: operationId || undefined, standard: intOf(standard), plan: intOf(plan),
      totalMakeQty: make, okQty: intOf(okQty), scrapQty: intOf(scrap) || undefined,
      reworkQty: intOf(rework) || undefined, mfQty: intOf(mf) || undefined,
      downtimeFrom: dtFrom || undefined, downtimeTo: dtTo || undefined,
      remark: remark.trim() || undefined,
    }
  }

  function clearQuantities() {
    setTotalMake(''); setOkQty(''); setScrap(''); setRework(''); setMf('')
    setDtFrom(''); setDtTo(''); setRemark('')
  }

  function addToBatch() {
    if (blockReason || rate == null) return
    const labelOf = (opts: { value: string; label: string }[], id: string) => opts.find((o) => o.value === id)?.label ?? id
    const key = crypto.randomUUID()
    setQueued((rows) => [...rows, {
      key, input: currentInput(), rate,
      employee: labelOf(employees, employeeId), machine: labelOf(machines, machineId),
      part: labelOf(parts, partId), operation: operationId ? labelOf(operations, operationId) : '—',
    }])
    setBatchErrors((errors) => { const next = { ...errors }; delete next[key]; return next })
    clearQuantities()
  }

  function validateQueuedRow(row: QueuedProduction): Record<string, string> {
    const i = row.input
    const errors: Record<string, string> = {}
    if (!i.date) errors.date = 'Date is required'
    if (!i.employeeId || !empById[i.employeeId]) errors.employee = 'Select a valid operator'
    if (!i.machineId || !machineById[i.machineId] || machineById[i.machineId]?.unitId !== i.unitId) errors.machine = 'Select a valid machine for this unit'
    if (!i.partId || !partById[i.partId] || partById[i.partId]?.unitId !== i.unitId) errors.part = 'Select a valid part for this unit'
    if (i.standard < 0) errors.standard = 'Start quantity cannot be negative'
    if (i.plan < i.standard) errors.plan = 'End quantity must be greater than or equal to start'
    if (i.totalMakeQty <= 0) errors.totalMakeQty = 'Total make must be greater than zero'
    const quantities = [i.okQty, i.scrapQty ?? 0, i.reworkQty ?? 0, i.mfQty ?? 0]
    if (quantities.some((qty) => qty < 0)) errors.quantities = 'Production quantities cannot be negative'
    if (quantities.reduce((sum, qty) => sum + qty, 0) > i.totalMakeQty) errors.quantities = 'OK + Scrap + Rework + MF exceeds total make'
    if (!(row.rate > 0)) errors.rate = 'A valid production rate is required'
    return errors
  }

  async function saveBatch() {
    if (!queued.length) return
    const errors: Record<string, Record<string, string>> = {}
    for (const row of queued) {
      const rowErrors = validateQueuedRow(row)
      if (Object.keys(rowErrors).length > 0) errors[row.key] = rowErrors
    }
    setBatchErrors(errors)
    if (Object.keys(errors).length > 0) {
      toastCommandError(new Error(`Correct the highlighted fields in ${Object.keys(errors).length} row(s)`))
      return
    }
    setSubmitting(true)
    try {
      await attendanceApi.createProductionBulk(queued.map((row) => row.input))
      await refreshAllData()
      toastCommandSuccess('Production batch saved', [`${queued.length} entries inserted`])
      setQueued([])
      setBatchErrors({})
      bumpRefresh()
    } catch (e) { toastCommandError(e) }
    finally { setSubmitting(false) }
  }

  return (
    <div className="space-y-4">
      {canCreate || canEdit ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">
            {editingId ? 'Edit production entry' : 'Production entry'}
          </div>
          <div className="space-y-4 p-4">
            {/* Basic */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fld label="Date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
              <Fld label="Shift No"><Sel value={shiftNo} set={setShiftNo} opts={SHIFT_OPTIONS} ph="— shift —" label="Shift No" /></Fld>
              <Fld label="Employee"><Sel value={employeeId} set={setEmployeeId} opts={employees} ph="Select…" label="Employee" /></Fld>
              <Fld label="Machine"><Sel value={machineId} set={setMachineId} opts={machines} ph={unitId ? 'Select…' : 'Pick employee first'} label="Machine" /></Fld>
              <Fld label="Part"><Sel value={partId} set={setPartId} opts={parts} ph={unitId ? 'Select…' : 'Pick employee first'} label="Part" /></Fld>
              <Fld label="Operation"><Sel value={operationId} set={setOperationId} opts={operations} ph="— any —" label="Operation" /></Fld>
            </div>

            {/* Production planning */}
            <Section title="Production planning">
              <Fld label="Standard">
                <div className="flex items-center gap-1.5">
                  <Num value={standard} set={setStandard} />
                  <button
                    type="button"
                    onClick={() => setStandard('0')}
                    title="Reset the counter sequence to 0 (e.g. after machine maintenance)"
                    className="shrink-0 rounded-md border border-border px-2 h-9 text-[12px] text-muted-fg hover:bg-muted"
                  >
                    Reset
                  </button>
                </div>
              </Fld>
              <Fld label="Plan"><Num value={plan} set={setPlan} /></Fld>
              <Fld label="Total make qty"><Num value={totalMake} set={setTotalMake} placeholder={String(autoMake)} /></Fld>
            </Section>

            {/* Details of production */}
            <Section title="Details of production">
              <Fld label="OK qty"><Num value={okQty} set={setOkQty} /></Fld>
              <Fld label="Scrap"><Num value={scrap} set={setScrap} /></Fld>
              <Fld label="Rework"><Num value={rework} set={setRework} /></Fld>
              <Fld label="MF"><Num value={mf} set={setMf} /></Fld>
            </Section>

            {/* Down time */}
            <Section title="Details of down time">
              <Fld label="From"><input type="time" className="input h-9" value={dtFrom} onChange={(e) => setDtFrom(e.target.value)} /></Fld>
              <Fld label="To"><input type="time" className="input h-9" value={dtTo} onChange={(e) => setDtTo(e.target.value)} /></Fld>
              <Fld label="Total"><input readOnly tabIndex={-1} className="input h-9 bg-muted text-muted-fg" value={fmtMins(downtime)} /></Fld>
              <Fld label="Remark"><input type="text" className="input h-9" value={remark} onChange={(e) => setRemark(e.target.value)} placeholder="e.g. tool change" /></Fld>
            </Section>

            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <span className="flex flex-wrap gap-x-6 gap-y-1.5" aria-live="polite">
                <span className="text-muted-fg">Made: <b className="text-fg mono">{make.toLocaleString('en-IN')}</b></span>
                <span className={overBreakdown ? 'text-danger' : 'text-muted-fg'}>
                  OK+Scrap+Rework+MF: <b className="mono">{breakdown.toLocaleString('en-IN')}</b>{overBreakdown ? ' › exceeds made' : ''}
                </span>
                <span className="text-muted-fg">Rate: <b className="text-fg mono">{rate != null ? `₹${fromPaise(rate).toLocaleString('en-IN')}` : '— no rate —'}</b></span>
                <span className="text-primary">Earned: <b className="mono">{formatINRSymbol(earned)}</b></span>
              </span>
              <div className="ml-auto flex items-center gap-2">
                {blockReason ? <span className="text-[12px] text-amber-600 dark:text-amber-500">{blockReason}</span> : null}
                {editingId ? (
                  <Button variant="secondary" leftIcon={<X size={14} />} onClick={resetForm} disabled={submitting}>
                    Cancel
                  </Button>
                ) : null}
                <Button
                  onClick={onSave}
                  loading={submitting}
                  disabled={!unitId || blockReason != null}
                >
                  {editingId ? 'Update production' : 'Save production'}
                </Button>
                {!editingId ? (
                  <Button variant="secondary" leftIcon={<ListPlus size={14} />} onClick={addToBatch} disabled={blockReason != null || submitting}>
                    Add row
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {queued.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold">Pending production batch</div>
              <div className="text-[11px] text-muted-fg">Review all rows before inserting them together.</div>
            </div>
            <Button className="ml-auto" onClick={() => void saveBatch()} loading={submitting}>Save all {queued.length}</Button>
          </div>
          <table className="w-full min-w-[1050px] text-[12px]">
            <thead><tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase text-muted-fg">
              {['Date','Shift','M/c','Type / Part','Operation','Operator','Start','End','Total make','OK','Scrap','Rework','MF','Rate / pc','Amount',''].map((h) => <th key={h} className="px-2 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>{queued.map((row) => {
              const i = row.input
              const errors = batchErrors[row.key] ?? {}
              const cell = (field: string) => errors[field] ? 'bg-danger/10 text-danger' : ''
              return <tr key={row.key} className="border-b border-border/60">
                <td className={`px-2 py-2 mono ${cell('date')}`} title={errors.date}>{formatDMY(i.date)}</td><td className="px-2 py-2">{i.shiftNo ?? '—'}</td>
                <td className={`px-2 py-2 ${cell('machine')}`} title={errors.machine}>{row.machine}</td><td className={`px-2 py-2 ${cell('part')}`} title={errors.part}>{row.part}</td><td className="px-2 py-2">{row.operation}</td><td className={`px-2 py-2 ${cell('employee')}`} title={errors.employee}>{row.employee}</td>
                <td className={`px-2 py-2 text-right mono ${cell('standard')}`} title={errors.standard}>{i.standard}</td><td className={`px-2 py-2 text-right mono ${cell('plan')}`} title={errors.plan}>{i.plan}</td><td className={`px-2 py-2 text-right mono ${cell('totalMakeQty')}`} title={errors.totalMakeQty}>{i.totalMakeQty}</td>
                <td className={`px-2 py-2 text-right mono ${cell('quantities')}`} title={errors.quantities}>{i.okQty}</td><td className={`px-2 py-2 text-right mono ${cell('quantities')}`} title={errors.quantities}>{i.scrapQty ?? 0}</td><td className={`px-2 py-2 text-right mono ${cell('quantities')}`} title={errors.quantities}>{i.reworkQty ?? 0}</td><td className={`px-2 py-2 text-right mono ${cell('quantities')}`} title={errors.quantities}>{i.mfQty ?? 0}</td>
                <td className={`px-2 py-2 text-right mono ${cell('rate')}`} title={errors.rate}>₹{fromPaise(row.rate)}</td><td className="px-2 py-2 text-right mono font-semibold">{formatINRSymbol(mulQty(row.rate, i.okQty))}</td>
                <td className="px-2 py-2"><button type="button" className="btn btn-ghost h-8 w-8 p-0 text-danger" onClick={() => { setQueued((rows) => rows.filter((x) => x.key !== row.key)); setBatchErrors((all) => { const next = { ...all }; delete next[row.key]; return next }) }} aria-label="Remove pending row"><Trash2 size={14} /></button></td>
              </tr>
            })}</tbody>
          </table>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No production entries" description="Record machine production above." /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Production entries</span>
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
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Shift</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Machine</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Made</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">OK</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Scrap</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Rework</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">MF</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Down-time</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Earned</th>
                {canEdit || canDelete ? <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr key={r.entry.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.entry.date)}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.shiftNo ?? '—'}</td>
                  <td className="px-3 py-2.5">{r.employeeName}</td>
                  <td className="px-3 py-2.5 mono">{r.machineNo}</td>
                  <td className="px-3 py-2.5">{r.partNo}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.makeQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.entry.okQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{(r.entry.scrapQty ?? 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{(r.entry.reworkQty ?? 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{(r.entry.mfQty ?? 0).toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono text-muted-fg">{fmtMins(r.downtimeMins)}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.earned)}</td>
                  {canEdit || canDelete ? (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <Button size="sm" variant="ghost" aria-label={`Edit production entry for ${r.employeeName}`} title="Edit" onClick={() => startEdit(r.entry)}><Pencil size={14} /></Button>
                        ) : null}
                        {canDelete ? (
                          <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete production entry for ${r.employeeName}`} title="Delete" onClick={() => setDeleting(r.entry)}><Trash2 size={14} /></Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
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
        title="Delete production entry?"
        confirmLabel="Delete"
        message={
          deleting ? (
            <>Delete the production entry for <b>{empById[deleting.employeeId]?.name ?? 'this operator'}</b> ({deleting.okQty.toLocaleString('en-IN')} OK pcs)? This can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

function ShiftTab() {
  const can = useCan()
  const canCreate = can('attendance', 'create')
  const canEdit = can('attendance', 'edit')
  const canDelete = can('attendance', 'delete')
  const empById = useStore((s) => s.masters.employees.byId)
  const rows = useStore(useShallow(selectShiftRows))
  const employees = useStore(useShallow(employeeOptionsWritable('shift')))

  const [editingId, setEditingId] = useState<Id | null>(null)
  const [deleting, setDeleting] = useState<ShiftAttendance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const [date, setDate] = useState(todayISO())
  const [shiftNo, setShiftNo] = useState('A')
  const [employeeId, setEmployeeId] = useState('')
  const [fromTime, setFromTime] = useState('09:00')
  const [toTime, setToTime] = useState('17:00')
  const [otHours, setOtHours] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [queued, setQueued] = useState<QueuedShift[]>([])
  const [formErrors, setFormErrors] = useState<Record<string, string>>({})

  // Unit derived from the chosen employee (no unit picker on the form).
  const unitId = employeeId ? empById[employeeId]?.unitId ?? '' : ''
  const hours = minutesBetween(fromTime, toTime) / 60
  const shiftRate = employeeId ? empById[employeeId]?.standardShiftRatePaise ?? (0 as Paise) : (0 as Paise)
  const otHoursNum = otHours ? Number(otHours) : 0
  // OT pays at the employee's standard hourly rate (the 8-hour shift rate ÷ 8) — no manual OT-rate entry.
  const otRatePaise = (shiftRate > 0 ? Math.round(shiftRate / 8) : 0) as Paise
  const wage = (Math.round((hours / 8) * shiftRate) + Math.round(otHoursNum * otRatePaise)) as Paise

  // Server-driven table in API mode; bump after a write so the fetched page reflects it.
  const [refreshKey, setRefreshKey] = useState(0)
  const bumpRefresh = () => setTimeout(() => setRefreshKey((k) => k + 1), 500)
  const paged = usePagedSource({
    localRows: rows,
    endpoint: '/attendance/shift',
    searchText: (r) => `${r.employeeName ?? ''} ${r.entry.shiftNo ?? ''}`,
    pageSize: 25,
    refreshKey,
  })

  function resetForm() {
    setEditingId(null)
    setShiftNo('1')
    setEmployeeId('')
    setFromTime('09:00')
    setToTime('17:00')
    setOtHours('')
    setFormErrors({})
  }

  function startEdit(entry: ShiftAttendance) {
    setEditingId(entry.id)
    setDate(entry.date)
    setShiftNo(entry.shiftNo ?? '')
    setEmployeeId(entry.employeeId)
    setFromTime(entry.fromTime)
    setToTime(entry.toTime)
    setOtHours(entry.otHours != null ? String(entry.otHours) : '')
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteShiftAttendance(deleting.id)
      toastCommandSuccess('Shift entry deleted', res.cascade)
      if (editingId === deleting.id) resetForm()
      setDeleting(null)
      bumpRefresh()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  function onSave() {
    const errors = validateCurrentShift()
    setFormErrors(errors)
    if (Object.keys(errors).length) {
      toastCommandError(new Error('Correct the highlighted shift fields'))
      return
    }
    setSubmitting(true)
    try {
      const res = runSaveShiftAttendance({
        id: editingId ?? undefined,
        unitId, date, shiftNo: shiftNo || undefined, employeeId, fromTime, toTime,
        otHours: otHoursNum > 0 ? otHoursNum : undefined,
        otRatePaise: otHoursNum > 0 ? otRatePaise : undefined,
      })
      toastCommandSuccess(editingId ? 'Shift updated' : 'Shift saved', res.cascade)
      bumpRefresh()
      if (editingId) resetForm()
      else setOtHours('')
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  function validateCurrentShift(): Record<string, string> {
    const errors: Record<string, string> = {}
    if (!date) errors.date = 'Date is required'
    if (!shiftNo) errors.shiftNo = 'Shift number is required'
    if (!employeeId || !empById[employeeId]) errors.employeeId = 'Select a valid employee'
    if (!unitId) errors.employeeId = 'Selected employee has no assigned unit'
    if (!fromTime) errors.fromTime = 'Available-from time is required'
    if (!toTime) errors.toTime = 'Available-to time is required'
    if (fromTime && toTime && hours <= 0) errors.toTime = 'To time must be after From time (same-day shifts only)'
    if (!Number.isFinite(otHoursNum) || otHoursNum < 0) errors.otHours = 'OT hours cannot be negative'
    if (shiftRate <= 0) errors.rate = 'Configure this employee’s shift rate before saving'
    return errors
  }

  function currentShiftInput(): Omit<ShiftInput, 'id'> {
    return {
      unitId, date, shiftNo, employeeId, fromTime, toTime,
      otHours: otHoursNum > 0 ? otHoursNum : undefined,
      otRatePaise: otHoursNum > 0 ? otRatePaise : undefined,
    }
  }

  function addShiftRow() {
    const errors = validateCurrentShift()
    setFormErrors(errors)
    if (Object.keys(errors).length) {
      toastCommandError(new Error('Correct the highlighted shift fields'))
      return
    }
    setQueued((all) => [...all, {
      key: crypto.randomUUID(), input: currentShiftInput(),
      employee: empById[employeeId]?.name ?? employeeId,
      rate: shiftRate, hours, wage,
    }])
    setEmployeeId('')
    setOtHours('')
    setFormErrors({})
  }

  async function saveShiftBatch() {
    if (!queued.length) return
    setSubmitting(true)
    try {
      await attendanceApi.createShiftBulk(queued.map((row) => row.input))
      await refreshAllData()
      toastCommandSuccess('Shift attendance batch saved', [`${queued.length} entries inserted`])
      setQueued([])
      bumpRefresh()
    } catch (e) {
      // Keep every pending row intact so the user can correct/retry it.
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {canCreate || canEdit ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">
            {editingId ? 'Edit shift entry' : 'Shift entry'}
          </div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fld label="Date"><input type="date" className={`input h-9 ${formErrors.date ? 'border-danger' : ''}`} value={date} onChange={(e) => setDate(e.target.value)} title={formErrors.date} /></Fld>
              <Fld label="Shift No"><Sel value={shiftNo} set={setShiftNo} opts={SHIFT_OPTIONS} ph="— shift —" label="Shift No" /></Fld>
              <Fld label="Employee"><div title={formErrors.employeeId}><Sel value={employeeId} set={setEmployeeId} opts={employees} ph="Select…" label="Employee" /></div></Fld>
              <Fld label="Available from"><input type="time" className={`input h-9 ${formErrors.fromTime ? 'border-danger' : ''}`} value={fromTime} onChange={(e) => setFromTime(e.target.value)} title={formErrors.fromTime} /></Fld>
              <Fld label="Available to"><input type="time" className={`input h-9 ${formErrors.toTime ? 'border-danger' : ''}`} value={toTime} onChange={(e) => setToTime(e.target.value)} title={formErrors.toTime} /></Fld>
              <Fld label="OT hours"><input type="number" min={0} step="0.5" className={`input h-9 ${formErrors.otHours ? 'border-danger' : ''}`} value={otHours} onChange={(e) => setOtHours(e.target.value)} title={formErrors.otHours} /></Fld>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <span className="flex flex-wrap gap-x-6 gap-y-1.5" aria-live="polite">
                <span className="text-muted-fg">Hours: <b className="text-fg mono">{hours.toLocaleString('en-IN')}</b></span>
                <span className="text-muted-fg">Shift rate/8h: <b className="text-fg mono">{formatINRSymbol(shiftRate)}</b></span>
                {otHoursNum > 0 ? (
                  <span className="text-muted-fg">OT: <b className="text-fg mono">{otHoursNum}h × {formatINRSymbol(otRatePaise)}/hr</b></span>
                ) : null}
                <span className="text-primary">Wage: <b className="mono">{formatINRSymbol(wage)}</b></span>
              </span>
              <div className="ml-auto flex items-center gap-2">
                {Object.values(formErrors)[0] ? <span className="text-[12px] text-danger">{Object.values(formErrors)[0]}</span> : null}
                {editingId ? (
                  <Button variant="secondary" leftIcon={<X size={14} />} onClick={resetForm} disabled={submitting}>
                    Cancel
                  </Button>
                ) : null}
                <Button onClick={onSave} loading={submitting} disabled={!unitId || !employeeId || hours <= 0 || (editingId ? !canEdit : !canCreate)}>
                  {editingId ? 'Update shift' : 'Save shift'}
                </Button>
                {!editingId ? (
                  <Button variant="secondary" leftIcon={<ListPlus size={14} />} onClick={addShiftRow} disabled={submitting}>
                    Add row
                  </Button>
                ) : null}
              </div>
            </div>
          </div>
        </Card>
      ) : null}

      {queued.length > 0 ? (
        <Card className="overflow-x-auto p-0">
          <div className="flex items-center gap-3 border-b border-border px-4 py-3">
            <div>
              <div className="text-[13px] font-semibold">Pending shift attendance</div>
              <div className="text-[11px] text-muted-fg">Review the rows; Save all inserts the complete batch together.</div>
            </div>
            <Button className="ml-auto" onClick={() => void saveShiftBatch()} loading={submitting}>Save all {queued.length}</Button>
          </div>
          <table className="w-full min-w-[900px] text-[12px]">
            <thead><tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase text-muted-fg">
              {['Date','Shift No.','Operator name','Available from','Available to','Total hrs present','Shift rate / 8 hr','Total amount',''].map((h) => <th key={h} className="px-3 py-2 font-semibold">{h}</th>)}
            </tr></thead>
            <tbody>{queued.map((row) => <tr key={row.key} className="border-b border-border/60">
              <td className="px-3 py-2 mono">{formatDMY(row.input.date)}</td>
              <td className="px-3 py-2 mono">{row.input.shiftNo}</td>
              <td className="px-3 py-2">{row.employee}</td>
              <td className="px-3 py-2 mono">{row.input.fromTime}</td>
              <td className="px-3 py-2 mono">{row.input.toTime}</td>
              <td className="px-3 py-2 text-right mono">{row.hours.toLocaleString('en-IN')}</td>
              <td className="px-3 py-2 text-right mono">{formatINRSymbol(row.rate)}</td>
              <td className="px-3 py-2 text-right mono font-semibold">{formatINRSymbol(row.wage)}</td>
              <td className="px-3 py-2"><button type="button" className="btn btn-ghost h-8 w-8 p-0 text-danger" onClick={() => setQueued((all) => all.filter((x) => x.key !== row.key))} aria-label="Remove pending shift row"><Trash2 size={14} /></button></td>
            </tr>)}</tbody>
          </table>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No shift entries" description="Record a shift above." /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3">
            <span className="text-[13px] font-semibold">Shift entries</span>
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
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Shift</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">From</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">To</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Hours</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Wage</th>
                {canEdit || canDelete ? <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th> : null}
              </tr>
            </thead>
            <tbody>
              {paged.pageRows.map((r) => (
                <tr key={r.entry.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.entry.date)}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.shiftNo ?? '—'}</td>
                  <td className="px-3 py-2.5">{r.employeeName}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.fromTime}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.toTime}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.hours.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.wage)}</td>
                  {canEdit || canDelete ? (
                    <td className="px-3 py-2.5">
                      <div className="flex items-center justify-end gap-1">
                        {canEdit ? (
                          <Button size="sm" variant="ghost" aria-label={`Edit shift entry for ${r.employeeName}`} title="Edit" onClick={() => startEdit(r.entry)}><Pencil size={14} /></Button>
                        ) : null}
                        {canDelete ? (
                          <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete shift entry for ${r.employeeName}`} title="Delete" onClick={() => setDeleting(r.entry)}><Trash2 size={14} /></Button>
                        ) : null}
                      </div>
                    </td>
                  ) : null}
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
        title="Delete shift entry?"
        confirmLabel="Delete"
        message={
          deleting ? (
            <>Delete the shift entry for <b>{empById[deleting.employeeId]?.name ?? 'this employee'}</b> ({deleting.fromTime}–{deleting.toTime})? This can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

function EarningsTab() {
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const rows = useStore(useShallow((s) => selectEarningsBetween(s, from || undefined, to || undefined)))
  const grandTotal = useMemo(() => rows.reduce((a, r) => a + r.total, 0) as Paise, [rows])

  return (
    <div className="space-y-4">
      <Card className="p-0">
        <div className="flex flex-wrap items-end gap-3 border-b border-border px-4 py-3">
          <div className="text-[13px] font-semibold">Earnings by employee</div>
          <div className="ml-auto flex flex-wrap items-end gap-3">
            <Fld label="From"><input type="date" className="input h-9" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} /></Fld>
            <Fld label="To"><input type="date" className="input h-9" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} /></Fld>
            <button
              type="button"
              className="btn btn-ghost h-9"
              onClick={() => { setFrom(''); setTo('') }}
              disabled={!from && !to}
            >
              Clear
            </button>
          </div>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            icon={CalendarClock}
            title={from || to ? 'No earnings in this period' : 'No earnings yet'}
            description={from || to ? 'Try a wider date range or clear the filter.' : 'Record production or shift attendance first.'}
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                  <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Production</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Shift wage</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-semibold">Total</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.employeeId} className="border-b border-border/60 hover:bg-muted/40">
                    <td className="px-3 py-2.5">{r.employeeName}</td>
                    <td className="px-3 py-2.5 text-right mono text-muted-fg">{formatINRSymbol(r.productionEarned)}</td>
                    <td className="px-3 py-2.5 text-right mono text-muted-fg">{formatINRSymbol(r.shiftWage)}</td>
                    <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border bg-muted/40 font-semibold">
                  <td className="px-3 py-2.5">{rows.length} employee{rows.length === 1 ? '' : 's'}</td>
                  <td className="px-3 py-2.5" />
                  <td className="px-3 py-2.5 text-right text-[11px] uppercase tracking-wide text-muted-fg">Total payment</td>
                  <td className="px-3 py-2.5 text-right mono text-primary">{formatINRSymbol(grandTotal)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-border pt-3">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">{children}</div>
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
function Num({ value, set, placeholder }: { value: string; set: (v: string) => void; placeholder?: string }) {
  return <input type="number" min={0} className="input h-9" value={value} placeholder={placeholder} onChange={(e) => set(e.target.value)} />
}
function Sel({ value, set, opts, ph, label }: { value: string; set: (v: string) => void; opts: { value: string; label: string }[]; ph: string; label?: string }) {
  return <SearchableDropdown value={value} onChange={set} options={opts} placeholder={ph} aria-label={label} />
}
