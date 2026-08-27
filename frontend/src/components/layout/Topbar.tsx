import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { Menu, Search } from 'lucide-react'
import { breadcrumbForPath } from '@/app/nav'
import { UnitSwitcher } from './UnitSwitcher'
import { UserMenu } from './UserMenu'
import { UndoRedo } from './UndoRedo'
import { ThemeToggle } from './ThemeToggle'

/** Sticky header: breadcrumb, register search, undo/redo, unit, theme, user. */
export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const { section, label } = breadcrumbForPath(pathname)
  const [q, setQ] = useState('')

  // Search drives the Inward/Outward register filter (challan/part/PO/heat).
  function onSearch(e: React.FormEvent) {
    e.preventDefault()
    const term = q.trim()
    navigate(term ? `/inward?q=${encodeURIComponent(term)}` : '/inward')
  }

  return (
    <header className="sticky top-0 z-30 flex h-[52px] items-center gap-3 border-b border-border bg-card px-3 sm:px-5">
      <button
        type="button"
        onClick={onMenu}
        className="btn btn-ghost h-9 w-9 p-0 lg:hidden"
        aria-label="Open navigation"
      >
        <Menu size={20} />
      </button>

      <nav aria-label="Breadcrumb" className="min-w-0 truncate text-xs text-muted-fg">
        {section ? <span className="hidden sm:inline">{section} / </span> : null}
        <span className="font-semibold text-fg">{label}</span>
      </nav>

      <form onSubmit={onSearch} role="search" className="relative ml-auto hidden md:block">
        <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          aria-label="Search the register by challan, part, PO or heat no"
          placeholder="Search challan, part, PO…"
          className="w-56 rounded-lg border border-border bg-bg py-1.5 pl-8 pr-3 text-xs text-fg placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring lg:w-64"
        />
      </form>

      <div className="flex items-center gap-1 sm:gap-2 md:ml-0 ml-auto">
        <div className="hidden sm:block">
          <UndoRedo />
        </div>
        <UnitSwitcher />
        <ThemeToggle />
        <UserMenu />
      </div>
    </header>
  )
}
