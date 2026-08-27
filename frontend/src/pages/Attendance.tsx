import { useState, useEffect, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { CalendarClock } from 'lucide-react'
import { formatINRSymbol, fromPaise, mulQty, toPaise, type Paise } from '@/lib/money'
import { formatDMY, todayISO } from '@/lib/date'
import { useStore } from '@/store'
import {
  unitOptions,
  operationOptions,
  partOptionsForUnit,
  machineOptionsForUnit,
  employeeOptionsForUnit,
} from '@/masters/options'
import { runSaveProductionAttendance, runSaveShiftAttendance } from '@/store/attendanceCommands'
import {
  selectProductionRows,
  selectShiftRows,
  selectEarnings,
  latestProductionRate,
  minutesBetween,
} from '@/selectors/attendance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, EmptyState, SearchableDropdown, Tabs } from '@/components/ui'

type TabKey = 'production' | 'shift' | 'earnings'
const TABS = [
  { value: 'production', label: 'Production' },
  { value: 'shift', label: 'Shift' },
  { value: 'earnings', label: 'Earnings' },
] as const
const intOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) ? Math.round(n) : 0
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
  const units = useStore(unitOptions)
  const operations = useStore(operationOptions)
  const rows = useStore(useShallow(selectProductionRows))

  const [unitId, setUnitId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [employeeId, setEmployeeId] = useState('')
  const [machineId, setMachineId] = useState('')
  const [partId, setPartId] = useState('')
  const [operationId, setOperationId] = useState('')
  // Pickers are scoped to the chosen unit; switching unit clears stale cross-unit picks.
  const parts = useStore(useShallow(partOptionsForUnit(unitId)))
  const machines = useStore(useShallow(machineOptionsForUnit(unitId)))
  const employees = useStore(useShallow(employeeOptionsForUnit(unitId, 'production')))
  useEffect(() => {
    setEmployeeId('')
    setMachineId('')
    setPartId('')
  }, [unitId])
  const [opening, setOpening] = useState('')
  const [closing, setClosing] = useState('')
  const [okQty, setOkQty] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const make = Math.max(0, intOf(closing) - intOf(opening))
  // Reactive: re-fetches if a production rate is edited while the form is open.
  const rate = useStore((s) =>
    partId ? latestProductionRate(s, partId, machineId || undefined, operationId || undefined, date) : undefined
  )
  const earned = rate != null ? mulQty(rate, intOf(okQty)) : (0 as Paise)

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveProductionAttendance({
        unitId, date, employeeId, machineId, partId, operationId: operationId || undefined,
        openingCounter: intOf(opening), closingCounter: intOf(closing), okQty: intOf(okQty),
      })
      toastCommandSuccess('Production saved', res.cascade)
      setOpening(closing)
      setClosing('')
      setOkQty('')
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {can('attendance', 'create') ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Production entry</div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fld label="Unit"><Sel value={unitId} set={setUnitId} opts={units} ph="Select unit…" label="Unit" /></Fld>
              <Fld label="Date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
              <Fld label="Employee"><Sel value={employeeId} set={setEmployeeId} opts={employees} ph="Select…" label="Employee" /></Fld>
              <Fld label="Machine"><Sel value={machineId} set={setMachineId} opts={machines} ph="Select…" label="Machine" /></Fld>
              <Fld label="Part"><Sel value={partId} set={setPartId} opts={parts} ph="Select…" label="Part" /></Fld>
              <Fld label="Operation"><Sel value={operationId} set={setOperationId} opts={operations} ph="— any —" label="Operation" /></Fld>
              <Fld label="Opening counter"><input type="number" min={0} className="input h-9" value={opening} onChange={(e) => setOpening(e.target.value)} /></Fld>
              <Fld label="Closing counter"><input type="number" min={0} className="input h-9" value={closing} onChange={(e) => setClosing(e.target.value)} /></Fld>
              <Fld label="OK qty"><input type="number" min={0} className="input h-9" value={okQty} onChange={(e) => setOkQty(e.target.value)} /></Fld>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <span className="flex flex-wrap gap-x-6 gap-y-1.5" aria-live="polite">
                <span className="text-muted-fg">Made: <b className="text-fg mono">{make.toLocaleString('en-IN')}</b></span>
                <span className="text-muted-fg">Rate: <b className="text-fg mono">{rate != null ? `₹${fromPaise(rate).toLocaleString('en-IN')}` : '— no rate —'}</b></span>
                <span className="text-primary">Earned: <b className="mono">{formatINRSymbol(earned)}</b></span>
              </span>
              <Button className="ml-auto" onClick={onSave} loading={submitting} disabled={!unitId || !employeeId || !machineId || !partId || rate == null || make <= 0}>
                Save production
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No production entries" description="Record machine production above." /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Machine</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Made</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">OK</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Earned</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entry.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.entry.date)}</td>
                  <td className="px-3 py-2.5">{r.employeeName}</td>
                  <td className="px-3 py-2.5 mono">{r.machineNo}</td>
                  <td className="px-3 py-2.5">{r.partNo}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.makeQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.entry.okQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.earned)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function ShiftTab() {
  const can = useCan()
  const units = useStore(unitOptions)
  const empById = useStore((s) => s.masters.employees.byId)
  const rows = useStore(useShallow(selectShiftRows))

  const [unitId, setUnitId] = useState('')
  const [date, setDate] = useState(todayISO())
  const [employeeId, setEmployeeId] = useState('')
  // Employee picker scoped to the chosen unit (shift labour); clears on unit change.
  const employees = useStore(useShallow(employeeOptionsForUnit(unitId, 'shift')))
  useEffect(() => setEmployeeId(''), [unitId])
  const [fromTime, setFromTime] = useState('09:00')
  const [toTime, setToTime] = useState('17:00')
  const [otHours, setOtHours] = useState('')
  const [otRate, setOtRate] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const hours = minutesBetween(fromTime, toTime) / 60
  const shiftRate = employeeId ? empById[employeeId]?.standardShiftRatePaise ?? (0 as Paise) : (0 as Paise)
  const otHoursNum = otHours ? Number(otHours) : 0
  const otRatePaise = otRate ? toPaise(Number(otRate)) : (0 as Paise)
  const wage = (Math.round((hours / 8) * shiftRate) + Math.round(otHoursNum * otRatePaise)) as Paise

  function onSave() {
    setSubmitting(true)
    try {
      const res = runSaveShiftAttendance({
        unitId, date, employeeId, fromTime, toTime,
        otHours: otHoursNum > 0 ? otHoursNum : undefined,
        otRatePaise: otHoursNum > 0 && otRate ? otRatePaise : undefined,
      })
      toastCommandSuccess('Shift saved', res.cascade)
      setOtHours('')
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      {can('attendance', 'create') ? (
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Shift entry</div>
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Fld label="Unit"><Sel value={unitId} set={setUnitId} opts={units} ph="Select unit…" label="Unit" /></Fld>
              <Fld label="Date"><input type="date" className="input h-9" value={date} onChange={(e) => setDate(e.target.value)} /></Fld>
              <Fld label="Employee"><Sel value={employeeId} set={setEmployeeId} opts={employees} ph="Select…" label="Employee" /></Fld>
              <Fld label="From"><input type="time" className="input h-9" value={fromTime} onChange={(e) => setFromTime(e.target.value)} /></Fld>
              <Fld label="To"><input type="time" className="input h-9" value={toTime} onChange={(e) => setToTime(e.target.value)} /></Fld>
              <Fld label="OT hours"><input type="number" min={0} step="0.5" className="input h-9" value={otHours} onChange={(e) => setOtHours(e.target.value)} /></Fld>
              <Fld label="OT rate / hr (₹)"><input type="number" min={0} step="0.01" className="input h-9" value={otRate} onChange={(e) => setOtRate(e.target.value)} /></Fld>
            </div>
            <div className="flex flex-wrap items-center gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
              <span className="flex flex-wrap gap-x-6 gap-y-1.5" aria-live="polite">
                <span className="text-muted-fg">Hours: <b className="text-fg mono">{hours.toLocaleString('en-IN')}</b></span>
                <span className="text-muted-fg">Shift rate/8h: <b className="text-fg mono">{formatINRSymbol(shiftRate)}</b></span>
                <span className="text-primary">Wage: <b className="mono">{formatINRSymbol(wage)}</b></span>
              </span>
              <Button className="ml-auto" onClick={onSave} loading={submitting} disabled={!unitId || !employeeId || hours <= 0}>
                Save shift
              </Button>
            </div>
          </div>
        </Card>
      ) : null}

      {rows.length === 0 ? (
        <Card><EmptyState icon={CalendarClock} title="No shift entries" description="Record a shift above." /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Employee</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">From</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">To</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Hours</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Wage</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.entry.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.entry.date)}</td>
                  <td className="px-3 py-2.5">{r.employeeName}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.fromTime}</td>
                  <td className="px-3 py-2.5 mono">{r.entry.toTime}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.hours.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{formatINRSymbol(r.wage)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

function EarningsTab() {
  const rows = useStore(useShallow(selectEarnings))
  if (rows.length === 0) {
    return <Card><EmptyState icon={CalendarClock} title="No earnings yet" description="Record production or shift attendance first." /></Card>
  }
  return (
    <Card className="overflow-x-auto p-0">
      <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Earnings by employee</div>
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
      </table>
    </Card>
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
function Sel({ value, set, opts, ph, label }: { value: string; set: (v: string) => void; opts: { value: string; label: string }[]; ph: string; label?: string }) {
  return (
    <SearchableDropdown value={value} onChange={set} options={opts} placeholder={ph} aria-label={label} />
  )
}
