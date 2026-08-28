import { Fragment } from 'react'
import { NavLink } from 'react-router-dom'
import { CheckCircle2, AlertTriangle } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useStore, currentUser } from '@/store'
import { getById } from '@/store/normalized'
import { selectReconcileScoped } from '@/selectors/reconcile'
import { useCan } from '@/hooks/useCan'
import { SIDEBAR_ITEMS, type NavItem } from '@/app/nav'

const ROLE_LABEL: Record<string, string> = {
  admin: 'Plant Admin',
  manager: 'Manager',
  operator: 'Operator',
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/)
  const first = parts[0]?.[0] ?? ''
  const last = parts.length > 1 ? parts[parts.length - 1]![0] : ''
  return (first + last).toUpperCase() || 'U'
}

/**
 * Left navigation — a dark rail (#0f172a) in both themes, matching the client
 * mock: a HEMANT ENGINEERING WORKS brand block, permission-filtered ERP modules
 * grouped in business-flow order, a stock-reconcile health pill, and
 * the signed-in user footer. Fixed on desktop; off-canvas drawer on mobile.
 */
export function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  const can = useCan()
  const user = useStore(currentUser)
  // Select a primitive (not the whole result object) so the always-mounted
  // sidebar re-renders only when the scoped imbalance count actually changes.
  const redCount = useStore((s) => selectReconcileScoped(s).redCount)
  const reconciled = redCount === 0
  const scopeLabel = useStore((s) => {
    if (user?.role === 'admin') return 'All units'
    const ids = user?.assignedUnitIds ?? []
    if (ids.length === 0) return 'No units'
    if (ids.length === 1) return getById(s.masters.units, ids[0]!)?.code ?? 'Unit'
    return `${ids.length} units`
  })

  const items = SIDEBAR_ITEMS.filter((i) => can(i.module, 'view'))

  return (
    <aside
      className={cn(
        'sidebar-rail fixed inset-y-0 left-0 z-40 flex w-[230px] flex-col bg-sidebar text-sidebar-fg transition-transform duration-200 lg:static lg:translate-x-0',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      )}
    >
      {/* Brand */}
      <div className="shrink-0 border-b border-sidebar-border px-4 py-3.5">
        <div className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-primary text-[13px] font-bold text-white shadow-sm">
            HE
          </span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="truncate text-[12.5px] font-bold uppercase tracking-wide text-white" title="Hemant Engineering Works">
              Hemant Engineering Works
            </div>
            <div className="truncate text-[10px] text-sidebar-muted">Job Work &amp; Billing Automation</div>
          </div>
        </div>
        <div className="mt-2.5 flex flex-wrap gap-1.5">
          <span className="rounded border border-white/10 bg-white/[0.06] px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-sidebar-muted">
            ISO 9001:2015
          </span>
          <span className="rounded border border-green-500/25 bg-green-500/10 px-1.5 py-0.5 text-[9px] font-medium tracking-wide text-green-400">
            GST Compliant
          </span>
        </div>
      </div>

      {/* Nav — standard ERP groups in business-flow order */}
      <nav className="scrollbar-thin min-h-0 flex-1 overflow-y-auto px-2.5 py-3">
        {items.map((item, index) => (
          <Fragment key={item.to}>
            {index === 0 || items[index - 1]?.section !== item.section ? (
              <div className={cn(
                'px-2.5 pb-1 text-[9px] font-semibold uppercase tracking-[0.14em] text-sidebar-muted/80',
                index === 0 ? 'pt-0' : 'pt-3'
              )}>
                {item.section}
              </div>
            ) : null}
            <div className="mb-0.5">
              <NavItemLink item={item} onNavigate={onNavigate} />
            </div>
          </Fragment>
        ))}
      </nav>

      {/* Reconcile health */}
      <NavLink
        to="/inventory"
        onClick={onNavigate}
        className={cn(
          // The rail is always near-black, so use bright -400 accents here for
          // AA contrast (token success/danger red fails AA on the dark sidebar).
          'mx-2.5 mb-2 mt-1 flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-medium focus-visible:ring-offset-sidebar',
          reconciled
            ? 'border-green-500/30 bg-green-500/15 text-green-400'
            : 'border-red-500/40 bg-red-500/15 text-red-400'
        )}
      >
        {reconciled ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}
        {reconciled ? 'Stock reconciled' : `${redCount} imbalance${redCount === 1 ? '' : 's'}`}
      </NavLink>

      {/* User footer */}
      <div className="mt-1 flex shrink-0 items-center gap-2.5 border-t border-sidebar-border px-3 py-3">
        <span className="grid h-[30px] w-[30px] place-items-center rounded-full bg-gradient-to-br from-indigo-400 to-indigo-700 text-xs font-semibold text-white">
          {user ? initials(user.name) : 'U'}
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-[12.5px] font-medium text-white">{user?.name ?? 'Signed out'}</div>
          <div className="truncate text-[10.5px] text-sidebar-muted">
            {user ? `${ROLE_LABEL[user.role] ?? user.role} · ${scopeLabel}` : '—'}
          </div>
        </div>
      </div>
    </aside>
  )
}

/** A single flat nav link. */
function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/dashboard'}
      onClick={onNavigate}
      title={item.blurb}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-[9px] text-[12.5px] transition-colors focus-visible:ring-offset-sidebar',
          isActive
            ? 'nav-active bg-sidebar-active font-semibold text-white shadow-sm ring-1 ring-inset ring-white/10'
            : 'text-sidebar-fg hover:bg-sidebar-hover hover:text-white'
        )
      }
    >
      <item.icon size={16} className="shrink-0 opacity-85" />
      <span className="truncate">{item.label}</span>
    </NavLink>
  )
}
