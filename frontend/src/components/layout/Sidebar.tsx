import { useState } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { CheckCircle2, AlertTriangle, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useStore, currentUser } from '@/store'
import { getById } from '@/store/normalized'
import { selectReconcileScoped } from '@/selectors/reconcile'
import { useCan } from '@/hooks/useCan'
import { NAV_SECTIONS, TOP_LEVEL, type NavItem } from '@/app/nav'

const COLLAPSE_KEY = 'hew-sidebar-collapsed'
function loadCollapsed(): Set<string> {
  try {
    return new Set(JSON.parse(localStorage.getItem(COLLAPSE_KEY) || '[]') as string[])
  } catch {
    return new Set()
  }
}

const ROLE_LABEL: Record<string, string> = {
  admin: 'Administrator',
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
 * Left navigation — a dark rail (mock `.sidebar`, #0f172a) in both themes.
 * Items are filtered by `can(module, 'view')`, so each role sees only the
 * modules it may open; empty sections drop out. Fixed on desktop; an
 * off-canvas drawer on mobile (controlled by AppLayout).
 */
export function Sidebar({ mobileOpen, onNavigate }: { mobileOpen: boolean; onNavigate: () => void }) {
  const can = useCan()
  const user = useStore(currentUser)
  const { pathname } = useLocation()
  const [collapsed, setCollapsed] = useState<Set<string>>(loadCollapsed)

  function toggleSection(title: string) {
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(title)) next.delete(title)
      else next.add(title)
      try {
        localStorage.setItem(COLLAPSE_KEY, JSON.stringify([...next]))
      } catch {
        /* ignore quota */
      }
      return next
    })
  }
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

  return (
    <aside
      className={cn(
        'sidebar-rail fixed inset-y-0 left-0 z-40 flex w-[218px] flex-col bg-sidebar text-sidebar-fg transition-transform duration-200 lg:static lg:translate-x-0',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full'
      )}
    >
      {/* Brand — fixed to the topbar height (52px) so their bottom borders align. */}
      <div className="flex h-[52px] shrink-0 items-center gap-2.5 border-b border-sidebar-border px-4">
        <span className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-gradient-to-br from-blue-400 to-primary text-[11px] font-bold text-white">
          HE
        </span>
        <div className="min-w-0 flex-1 leading-tight">
          <div className="truncate text-sm font-bold text-white" title="Hemant Engineering Works">Hemant Eng. Works</div>
          <div className="truncate text-[10px] text-sidebar-muted">Job Work &amp; Billing</div>
        </div>
      </div>

      {/* Nav */}
      <nav className="scrollbar-thin min-h-0 flex-1 space-y-0.5 overflow-y-auto px-2 py-2.5">
        {/* Standalone top-level links (Dashboard) — no section header. */}
        {TOP_LEVEL.filter((i) => can(i.module, 'view')).map((item) => (
          <NavItemLink key={item.module} item={item} onNavigate={onNavigate} />
        ))}
        {NAV_SECTIONS.map((section) => {
          const items = section.items.filter((i) => can(i.module, 'view'))
          if (items.length === 0) return null
          // A section that holds the current route stays open regardless of the
          // user's collapse choice, so you always see where you are.
          const hasActive = items.some((i) => (i.to === '/' ? pathname === '/' : pathname.startsWith(i.to)))
          const isOpen = hasActive || !collapsed.has(section.title)
          return (
            <div key={section.title} className="pb-1">
              <button
                type="button"
                onClick={() => toggleSection(section.title)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between rounded-md px-2.5 pb-1 pt-3 text-[9.5px] font-semibold uppercase tracking-[0.08em] text-sidebar-section transition-colors hover:text-sidebar-fg focus-visible:ring-offset-sidebar"
              >
                <span>{section.title}</span>
                <ChevronDown size={12} className={cn('transition-transform duration-200', !isOpen && '-rotate-90')} aria-hidden />
              </button>
              {isOpen ? (
                <ul className="space-y-px">
                  {items.map((item) => (
                    <li key={item.module}>
                      <NavItemLink item={item} onNavigate={onNavigate} />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          )
        })}
      </nav>

      {/* Reconcile health */}
      <NavLink
        to="/"
        end
        onClick={onNavigate}
        className={cn(
          // The rail is always near-black, so use bright -400 accents here for
          // AA contrast (token success/danger red fails AA on the dark sidebar).
          'mx-2 mb-2 mt-1 flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-2 text-[11px] font-medium focus-visible:ring-offset-sidebar',
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

/** A single nav link — shared by the standalone top-level links and the
 *  grouped section items so their look + active state stay identical. */
function NavItemLink({ item, onNavigate }: { item: NavItem; onNavigate: () => void }) {
  return (
    <NavLink
      to={item.to}
      end={item.to === '/'}
      onClick={onNavigate}
      title={item.blurb}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-lg px-2.5 py-[7px] text-[12.5px] transition-colors focus-visible:ring-offset-sidebar',
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
