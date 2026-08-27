import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, Building2, Activity, Boxes } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/cn'
import { formatINRSymbol } from '@/lib/money'
import { useStore, currentUser } from '@/store'
import { getById } from '@/store/normalized'
import { selectDashboardKpis } from '@/selectors/kpi'
import { selectStockRows } from '@/selectors/register'
import { Badge, Card, EmptyState, Kpi, KpiGrid } from '@/components/ui'

export default function Dashboard() {
  const user = useStore(currentUser)
  const kpis = useStore(selectDashboardKpis)
  const unitLabel = useStore((s) => {
    const cur = s.session.currentUnitId
    if (!cur || cur === 'ALL') return user?.role === 'admin' ? 'All units' : 'All assigned units'
    return getById(s.masters.units, cur)?.name ?? 'Unit'
  })
  const activityLog = useStore((s) => s.system.activityLog)
  const activity = useMemo(() => activityLog.slice(-7).reverse(), [activityLog])
  const usersById = useStore((s) => s.masters.users.byId)
  const unitsById = useStore((s) => s.masters.units.byId)
  const userName = (id: string): string => usersById[id]?.name ?? 'system'

  const stockRows = useStore(useShallow(selectStockRows))
  const lowest = useMemo(
    () => [...stockRows].sort((a, b) => a.available - b.available).slice(0, 5),
    [stockRows]
  )

  return (
    <div className="space-y-4">
      {/* Page head */}
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold tracking-tight">Dashboard</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">
            <Building2 size={13} className="mr-1 inline" />
            Live across {unitLabel.toLowerCase()}
          </p>
        </div>
        <ReconcilePill ok={kpis.reconcileOk} red={kpis.reconcileRed} />
      </div>

      {/* KPIs */}
      <KpiGrid>
        <Kpi
          tone="blue"
          label="Open challans"
          value={kpis.openInwards.toLocaleString('en-IN')}
          sub={`of ${kpis.inwardsTotal.toLocaleString('en-IN')} inward`}
        />
        <Kpi tone="green" label="Revenue invoiced" value={formatINRSymbol(kpis.invoiced)} sub="incl. GST" />
        <Kpi
          tone="amber"
          label="Outstanding"
          value={formatINRSymbol(kpis.outstanding)}
          sub={kpis.overdueInvoices > 0 ? `${kpis.overdueInvoices} overdue` : 'awaiting payment'}
        />
        <Kpi tone="purple" label="Draft invoices" value={kpis.draftInvoices.toLocaleString('en-IN')} sub="awaiting billing" />
      </KpiGrid>

      {/* Two-column row */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Card className="p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Recent activity</div>
          {activity.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Activity} title="No activity yet" description="Actions you take appear here as an audit trail." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {activity.map((a) => (
                <li key={a.id} className="flex items-start gap-3 px-4 py-2.5">
                  <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted text-muted-fg">
                    <Activity size={14} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px]">{a.summary}</p>
                    <p className="text-[11px] text-faint">
                      {userName(a.userId)} · {a.command} · {new Date(a.ts).toLocaleString('en-IN')}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="p-0">
          <div className="flex items-center gap-2 border-b border-border px-4 py-3 text-[13px] font-semibold">
            <Boxes size={15} className="text-warning" /> Lowest available stock
          </div>
          {lowest.length === 0 ? (
            <div className="p-4">
              <EmptyState icon={Boxes} title="No stock yet" description="Stock appears as inwards and openings are recorded." />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {lowest.map((r) => (
                <li key={`${r.unitId}:${r.partId}`} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px]">
                  <span className="min-w-0 truncate">
                    <span className="mono font-medium">{r.partNo}</span>
                    <span className="ml-1.5 text-[11px] text-faint">{unitsById[r.unitId]?.code ?? ''}</span>
                  </span>
                  <Badge tone={r.available <= 0 ? 'danger' : r.available <= 100 ? 'warning' : 'success'}>
                    {r.available.toLocaleString('en-IN')} pcs
                  </Badge>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <p className="text-center text-[11px] text-faint">
        Modules light up as each phase ships — start in{' '}
        <Link to="/masters" className="text-primary hover:underline">
          Masters
        </Link>
        .
      </p>
    </div>
  )
}

function ReconcilePill({ ok, red }: { ok: boolean; red: number }) {
  return (
    <div
      className={cn(
        'flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13px] font-medium',
        ok ? 'border-success/30 bg-success/10 text-success' : 'border-danger/30 bg-danger/10 text-danger'
      )}
    >
      {ok ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
      <span>{ok ? 'Stock reconciled' : `${red} imbalance${red === 1 ? '' : 's'}`}</span>
    </div>
  )
}
