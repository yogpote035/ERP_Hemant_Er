import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Cell,
} from 'recharts'
import { useShallow } from 'zustand/react/shallow'
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  Wallet,
  ReceiptText,
  TrendingUp,
  Truck,
  Factory,
  CheckCircle2,
  AlertTriangle,
} from 'lucide-react'
import { cn } from '@/lib/cn'
import { fromPaise, formatINRSymbol, type Paise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { values } from '@/store/normalized'
import { useStore, currentUser } from '@/store'
import type { RootState } from '@/store/state'
import { allowedUnitIds, scopedDispatches } from '@/store/scope'
import type { Invoice } from '@/types/domain'
import {
  invoiceGrand,
  invoiceCustomerName,
  invoicePaymentStatus,
  type PaymentStatus,
} from '@/selectors/billing'
import { selectDashboardKpis } from '@/selectors/kpi'
import { selectInwardRows, selectStockRows } from '@/selectors/register'
import { selectExpenseRows, type ExpenseStatus } from '@/selectors/finance'
import { Badge, Card, EmptyState, Kpi, KpiGrid, type BadgeTone } from '@/components/ui'

/** Compact Indian-currency for KPI tiles: ₹1.24Cr · ₹18.4L · ₹92.4k · ₹420. */
function compactINR(p: Paise): string {
  const r = fromPaise(p)
  const abs = Math.abs(r)
  const sign = r < 0 ? '-' : ''
  if (abs >= 1e7) return `${sign}₹${(abs / 1e7).toFixed(2)}Cr`
  if (abs >= 1e5) return `${sign}₹${(abs / 1e5).toFixed(1)}L`
  if (abs >= 1e3) return `${sign}₹${(abs / 1e3).toFixed(1)}k`
  return `${sign}₹${Math.round(abs).toLocaleString('en-IN')}`
}

const int = (n: number) => Math.round(n).toLocaleString('en-IN')

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (key: string) => MONTHS[Number(key.slice(5, 7)) - 1] ?? key

/** Status pill tone maps shared by the dashboard tables. */
const PAY_TONE: Record<PaymentStatus, BadgeTone> = {
  paid: 'success', partial: 'warning', overdue: 'danger', unpaid: 'primary', draft: 'muted', void: 'muted',
}
const EXP_TONE: Record<ExpenseStatus, BadgeTone> = {
  paid: 'success', partial: 'warning', overdue: 'danger', unpaid: 'primary',
}
const PAY_LABEL: Record<PaymentStatus, string> = {
  paid: 'Paid', partial: 'Partial', overdue: 'Overdue', unpaid: 'Pending', draft: 'Draft', void: 'Void',
}
const EXP_LABEL: Record<ExpenseStatus, string> = {
  paid: 'Paid', partial: 'Partial', overdue: 'Overdue', unpaid: 'Pending',
}

interface InvoiceLite {
  id: string
  billNo: string
  invoiceDate: string
  customer: string
  grand: Paise
  status: PaymentStatus
}

/** Scoped, non-void invoices, newest first. */
function selectScopedInvoices(s: RootState): InvoiceLite[] {
  const allowed = allowedUnitIds(s)
  return values(s.billing.invoices)
    .filter((inv: Invoice) => allowed.has(inv.unitId) && inv.lifecycle !== 'void')
    .sort((a, b) => b.invoiceDate.localeCompare(a.invoiceDate))
    .map((inv) => ({
      id: inv.id,
      billNo: inv.billNo,
      invoiceDate: inv.invoiceDate,
      customer: invoiceCustomerName(s, inv),
      grand: invoiceGrand(inv),
      status: invoicePaymentStatus(s, inv),
    }))
}

type RangePreset = 'all' | 'today' | 'week' | 'month' | 'custom'
const PRESETS: { key: RangePreset; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'today', label: 'Today' },
  { key: 'week', label: 'This week' },
  { key: 'month', label: 'This month' },
  { key: 'custom', label: 'Custom' },
]
/** [from, to] ISO dates for a preset; '' = unbounded (today/week/month key off the local date). */
function presetRange(preset: RangePreset): { from: string; to: string } {
  const today = todayISO()
  if (preset === 'today') return { from: today, to: today }
  if (preset === 'week') {
    const d = new Date(today + 'T00:00:00')
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7)) // back to Monday
    return { from: d.toISOString().slice(0, 10), to: today }
  }
  if (preset === 'month') return { from: today.slice(0, 8) + '01', to: today }
  return { from: '', to: '' } // all / custom
}

function RangeControl({ preset, setPreset, cFrom, setCFrom, cTo, setCTo }: {
  preset: RangePreset; setPreset: (p: RangePreset) => void
  cFrom: string; setCFrom: (v: string) => void; cTo: string; setCTo: (v: string) => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {PRESETS.map((p) => (
        <button
          key={p.key}
          type="button"
          onClick={() => setPreset(p.key)}
          className={cn('h-8 rounded-md border px-2.5 text-[12px] transition-colors', preset === p.key ? 'border-primary bg-primary/10 font-medium text-primary' : 'border-border text-muted-fg hover:bg-muted')}
        >
          {p.label}
        </button>
      ))}
      {preset === 'custom' ? (
        <>
          <input type="date" aria-label="From date" value={cFrom} onChange={(e) => setCFrom(e.target.value)} className="input h-8 w-[140px] text-[12px]" />
          <span className="text-muted-fg">–</span>
          <input type="date" aria-label="To date" value={cTo} onChange={(e) => setCTo(e.target.value)} className="input h-8 w-[140px] text-[12px]" />
        </>
      ) : null}
    </div>
  )
}

export default function Dashboard() {
  const user = useStore(currentUser)
  const kpis = useStore(selectDashboardKpis)
  const inwardRows = useStore(useShallow(selectInwardRows))
  const stockRows = useStore(useShallow(selectStockRows))
  const expenseRows = useStore(useShallow(selectExpenseRows))
  const invoices = useStore(useShallow(selectScopedInvoices))
  const activeVendors = useStore((s) => values(s.masters.vendors).filter((v) => v.active).length)
  const dispatchRows = useStore(
    useShallow((s) => scopedDispatches(s).map((d) => ({ date: d.dispatchDate ?? d.billDate ?? '', ok: d.okQty, qty: d.okQty + d.mcRejQty + d.mfQty })))
  )

  // FR-D06 — date-range filter (today / this week / this month / custom). Empty range
  // = all time. PERIOD metrics + trend charts respect it; point-in-time snapshots
  // (live stock, pending payments, active vendors) are always "as of now".
  const [preset, setPreset] = useState<RangePreset>('all')
  const [cFrom, setCFrom] = useState('')
  const [cTo, setCTo] = useState('')
  const { from, to } = preset === 'custom' ? { from: cFrom, to: cTo } : presetRange(preset)
  const inRange = (d: string | undefined): boolean => (!from || (!!d && d >= from)) && (!to || (!!d && d <= to))

  const rInward = useMemo(() => inwardRows.filter((r) => inRange(r.inward.challanDate)), [inwardRows, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rInvoices = useMemo(() => invoices.filter((i) => inRange(i.invoiceDate)), [invoices, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rExpenses = useMemo(() => expenseRows.filter((r) => inRange(r.expense.date)), [expenseRows, from, to]) // eslint-disable-line react-hooks/exhaustive-deps
  const rDispatch = useMemo(() => dispatchRows.filter((d) => inRange(d.date)), [dispatchRows, from, to]) // eslint-disable-line react-hooks/exhaustive-deps

  const totalInward = useMemo(() => rInward.reduce((a, r) => a + r.received, 0), [rInward])
  const totalDispatch = useMemo(() => rDispatch.reduce((a, d) => a + d.ok, 0), [rDispatch])
  const piecesDispatched = useMemo(() => rDispatch.reduce((a, d) => a + d.qty, 0), [rDispatch])
  const issuedInvoices = useMemo(() => rInvoices.filter((i) => i.status !== 'draft'), [rInvoices])
  const revenueIssued = useMemo(() => issuedInvoices.reduce((a, i) => a + i.grand, 0) as Paise, [issuedInvoices])
  const draftCount = useMemo(() => rInvoices.filter((i) => i.status === 'draft').length, [rInvoices])
  // Snapshots — current state, independent of the date range.
  const liveStock = useMemo(() => stockRows.reduce((a, r) => a + Math.max(0, r.available), 0), [stockRows])
  const pendingPayments = useMemo(() => expenseRows.reduce((a, r) => a + r.balance, 0) as Paise, [expenseRows])

  // Revenue vs Expenses, last 6 months present in the data (no dependence on "now").
  const revVsExp = useMemo(() => {
    const m = new Map<string, { revenue: number; expense: number }>()
    const bump = (key: string, k: 'revenue' | 'expense', v: number) => {
      const cur = m.get(key) ?? { revenue: 0, expense: 0 }
      cur[k] += v
      m.set(key, cur)
    }
    for (const inv of rInvoices) bump(inv.invoiceDate.slice(0, 7), 'revenue', fromPaise(inv.grand))
    for (const r of rExpenses) bump(r.expense.date.slice(0, 7), 'expense', fromPaise(r.expense.totalPaise))
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([key, v]) => ({ month: monthLabel(key), revenue: Math.round(v.revenue), expense: Math.round(v.expense) }))
  }, [rInvoices, rExpenses])

  // Revenue by customer (the mock's "Dispatch by Customer"), top 6.
  const byCustomer = useMemo(() => {
    const m = new Map<string, number>()
    for (const inv of issuedInvoices) m.set(inv.customer, (m.get(inv.customer) ?? 0) + fromPaise(inv.grand))
    return [...m.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [issuedInvoices])

  // Stock Movement — Inward vs Outward pieces by month (last 6 present).
  const stockMovement = useMemo(() => {
    const m = new Map<string, { inward: number; outward: number }>()
    const bump = (key: string, k: 'inward' | 'outward', v: number) => {
      if (!key) return
      const cur = m.get(key) ?? { inward: 0, outward: 0 }
      cur[k] += v
      m.set(key, cur)
    }
    for (const r of rInward) bump(r.inward.challanDate.slice(0, 7), 'inward', r.received)
    for (const d of rDispatch) bump(d.date.slice(0, 7), 'outward', d.ok)
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-6)
      .map(([key, v]) => ({ month: monthLabel(key), inward: v.inward, outward: v.outward }))
  }, [rInward, rDispatch])

  // Pending Payments — outstanding supplier dues by vendor, top 6.
  const pendingByVendor = useMemo(() => {
    const m = new Map<string, number>()
    for (const r of expenseRows) {
      if (r.balance <= 0) continue
      const name = r.vendorName || r.expense.category || '—'
      m.set(name, (m.get(name) ?? 0) + fromPaise(r.balance))
    }
    return [...m.entries()]
      .map(([name, value]) => ({ name, value: Math.round(value) }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 6)
  }, [expenseRows])

  // Available stock by material, top 7.
  const byMaterial = useMemo(
    () =>
      [...stockRows]
        .filter((r) => r.available > 0)
        .sort((a, b) => b.available - a.available)
        .slice(0, 7)
        .map((r) => ({ name: r.partNo, value: r.available })),
    [stockRows]
  )

  const pendingTable = useMemo(() => expenseRows.filter((r) => r.balance > 0).slice(0, 5), [expenseRows])
  const recentInward = useMemo(() => inwardRows.slice(0, 5), [inwardRows])
  const latestInvoices = useMemo(() => invoices.slice(0, 5), [invoices])

  const greeting = user ? user.name.split(/\s+/)[0] : 'there'

  return (
    <div className="space-y-5">
      {/* Page head */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">
            Welcome back, {greeting} — live job-work operations across your units.
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <ReconcilePill ok={kpis.reconcileOk} red={kpis.reconcileRed} />
          <Link to="/inward" className="btn btn-primary h-9">
            <ArrowDownToLine size={15} /> New Entry
          </Link>
        </div>
      </div>

      {/* Date-range filter (FR-D06) */}
      <div className="flex flex-wrap items-center gap-3">
        <RangeControl preset={preset} setPreset={setPreset} cFrom={cFrom} setCFrom={setCFrom} cTo={cTo} setCTo={setCTo} />
        {from || to ? (
          <span className="text-[11.5px] text-muted-fg">Period {from || '…'} → {to || '…'} · live stock, supplier dues &amp; vendors shown as of now</span>
        ) : null}
      </div>

      {/* 8 KPI cards */}
      <KpiGrid>
        <Kpi tone="blue" label="Total Inward" value={int(totalInward)} sub="pcs received" />
        <Kpi tone="green" label="Total Dispatch" value={int(totalDispatch)} sub="pcs dispatched" />
        <Kpi tone="amber" label="Live Stock" value={int(liveStock)} sub={`${stockRows.length} SKUs`} />
        <Kpi tone="red" label="Pending Payments" value={compactINR(pendingPayments)} sub="supplier dues" />
        <Kpi tone="green" label="Revenue (issued)" value={compactINR(revenueIssued)} sub="incl. GST" />
        <Kpi tone="purple" label="Invoices Issued" value={int(issuedInvoices.length)} sub={`${draftCount} draft`} />
        <Kpi tone="blue" label="Active Vendors" value={int(activeVendors)} sub="suppliers" />
        <Kpi tone="amber" label="Production" value={int(piecesDispatched)} sub="pcs billed-out" />
      </KpiGrid>

      {/* Charts */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Revenue vs Expenses" icon={TrendingUp}>
          {revVsExp.length === 0 ? (
            <ChartEmpty label="No revenue or expense data yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={revVsExp} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'rgb(var(--muted) / 0.5)' }} />
                <Bar dataKey="revenue" name="Revenue" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="expense" name="Expenses" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Revenue by Customer" icon={Truck}>
          {byCustomer.length === 0 ? (
            <ChartEmpty label="No invoices yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart layout="vertical" data={byCustomer} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10.5 }} stroke="rgb(var(--muted-fg))" width={120} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'rgb(var(--muted) / 0.5)' }} />
                <Bar dataKey="value" name="Revenue" fill="#7c3aed" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      {/* Stock Movement + Pending Payments */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <ChartCard title="Stock Movement" icon={ArrowUpFromLine}>
          {stockMovement.length === 0 ? (
            <ChartEmpty label="No inward / outward movement yet" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={stockMovement} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
                <XAxis dataKey="month" tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} width={40} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--muted) / 0.5)' }} />
                <Bar dataKey="inward" name="Inward" fill="#2563eb" radius={[4, 4, 0, 0]} maxBarSize={26} />
                <Bar dataKey="outward" name="Outward" fill="#16a34a" radius={[4, 4, 0, 0]} maxBarSize={26} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>

        <ChartCard title="Pending Payments" icon={Wallet}>
          {pendingByVendor.length === 0 ? (
            <ChartEmpty label="No outstanding supplier dues" />
          ) : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart layout="vertical" data={pendingByVendor} margin={{ top: 4, right: 12, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" horizontal={false} />
                <XAxis type="number" tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" tickFormatter={(v) => `${Math.round(v / 1000)}k`} tickLine={false} axisLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 10.5 }} stroke="rgb(var(--muted-fg))" width={120} tickLine={false} axisLine={false} />
                <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'rgb(var(--muted) / 0.5)' }} />
                <Bar dataKey="value" name="Outstanding" fill="#dc2626" radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </ChartCard>
      </div>

      <ChartCard title="Available Stock by Material" icon={Boxes}>
        {byMaterial.length === 0 ? (
          <ChartEmpty label="No stock recorded yet" />
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={byMaterial} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgb(var(--border))" vertical={false} />
              <XAxis dataKey="name" tick={{ fontSize: 10.5 }} stroke="rgb(var(--muted-fg))" tickLine={false} interval={0} />
              <YAxis tick={{ fontSize: 11 }} stroke="rgb(var(--muted-fg))" width={44} tickLine={false} axisLine={false} />
              <Tooltip content={<ChartTooltip />} cursor={{ fill: 'rgb(var(--muted) / 0.5)' }} />
              <Bar dataKey="value" name="Available" radius={[4, 4, 0, 0]} maxBarSize={48}>
                {byMaterial.map((r) => (
                  <Cell key={r.name} fill={r.value <= 100 ? '#d97706' : '#2563eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )}
      </ChartCard>

      {/* Three tables */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        {/* Top supplier dues (detail behind the Pending Payments chart) */}
        <TableCard title="Top Supplier Dues" icon={Wallet} viewAll="/expenses">
          {pendingTable.length === 0 ? (
            <ChartEmpty label="No outstanding supplier dues" />
          ) : (
            <Rows>
              {pendingTable.map((r) => (
                <li key={r.expense.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{r.vendorName}</span>
                    <span className="block truncate text-[11px] text-faint">{r.expense.category || '—'}</span>
                  </span>
                  <span className="mono shrink-0 text-right tabular-nums">{formatINRSymbol(r.balance)}</span>
                  <Badge tone={EXP_TONE[r.status]} className="shrink-0">{EXP_LABEL[r.status]}</Badge>
                </li>
              ))}
            </Rows>
          )}
        </TableCard>

        {/* Recent Inward */}
        <TableCard title="Recent Inward Entries" icon={ArrowDownToLine} viewAll="/inward">
          {recentInward.length === 0 ? (
            <ChartEmpty label="No inward challans yet" />
          ) : (
            <Rows>
              {recentInward.map((r) => (
                <li key={r.inward.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="mono block truncate font-medium">{r.inward.challanNo}</span>
                    <span className="block truncate text-[11px] text-faint">{r.vendorName}</span>
                  </span>
                  <span className="mono shrink-0 text-[11px] text-muted-fg">{r.partNo}</span>
                  <span className="mono shrink-0 text-right tabular-nums">{int(r.received)}</span>
                </li>
              ))}
            </Rows>
          )}
        </TableCard>

        {/* Latest Invoices */}
        <TableCard title="Latest Invoices" icon={ReceiptText} viewAll="/billing">
          {latestInvoices.length === 0 ? (
            <ChartEmpty label="No invoices yet" />
          ) : (
            <Rows>
              {latestInvoices.map((inv) => (
                <li key={inv.id} className="flex items-center gap-2 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 flex-1">
                    <span className="mono block truncate font-medium">{inv.billNo}</span>
                    <span className="block truncate text-[11px] text-faint">{inv.customer}</span>
                  </span>
                  <span className="mono shrink-0 text-right tabular-nums">{formatINRSymbol(inv.grand)}</span>
                  <Badge tone={PAY_TONE[inv.status]} className="shrink-0">{PAY_LABEL[inv.status]}</Badge>
                </li>
              ))}
            </Rows>
          )}
        </TableCard>
      </div>
    </div>
  )
}

function ReconcilePill({ ok, red }: { ok: boolean; red: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3 py-2 text-[12.5px] font-medium',
        ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'
      )}
    >
      {ok ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
      <span className="hidden sm:inline">{ok ? 'Stock reconciled' : `${red} imbalance${red === 1 ? '' : 's'}`}</span>
    </div>
  )
}

function ChartCard({ title, icon: Icon, children }: { title: string; icon: typeof Boxes; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold">
        <Icon size={15} className="text-primary" /> {title}
      </div>
      <div className="p-3">{children}</div>
    </Card>
  )
}

function TableCard({ title, icon: Icon, viewAll, children }: { title: string; icon: typeof Boxes; viewAll: string; children: React.ReactNode }) {
  return (
    <Card className="p-0">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold">
          <Icon size={15} className="text-primary" /> {title}
        </span>
        <Link to={viewAll} className="text-[11.5px] font-medium text-primary hover:underline">
          View all
        </Link>
      </div>
      {children}
    </Card>
  )
}

function Rows({ children }: { children: React.ReactNode }) {
  return <ul className="divide-y divide-border">{children}</ul>
}

function ChartEmpty({ label }: { label: string }) {
  return (
    <div className="py-6">
      <EmptyState icon={Factory} title={label} description="Records appear here as the team enters them." />
    </div>
  )
}

/** Themed tooltip used by all dashboard charts. */
function ChartTooltip({ active, payload, label, money }: { active?: boolean; payload?: { name: string; value: number; color?: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null
  return (
    <div className="rounded-lg border border-border bg-card px-3 py-2 text-[11.5px] shadow-lg">
      {label ? <div className="mb-1 font-semibold text-fg">{label}</div> : null}
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2 text-muted-fg">
          <span className="h-2 w-2 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="mono font-medium text-fg">{money ? `₹${Math.round(p.value).toLocaleString('en-IN')}` : Math.round(p.value).toLocaleString('en-IN')}</span>
        </div>
      ))}
    </div>
  )
}
