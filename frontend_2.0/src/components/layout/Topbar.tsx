import { Link, useLocation } from 'react-router-dom'
import { Menu, Settings } from 'lucide-react'
import { breadcrumbForPath } from '@/app/nav'
import { GlobalSearch } from './GlobalSearch'
import { UnitSwitcher } from './UnitSwitcher'
import { UserMenu } from './UserMenu'
import { UndoRedo } from './UndoRedo'
import { ThemeToggle } from './ThemeToggle'

/** Sticky header: breadcrumb, global search, undo/redo, unit, theme, user. */
export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { pathname } = useLocation()
  const { section, label } = breadcrumbForPath(pathname)

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

      <GlobalSearch />

      <div className="flex items-center gap-1 sm:gap-2 md:ml-0 ml-auto">
        <div className="hidden sm:block">
          <UndoRedo />
        </div>
        <UnitSwitcher />
        <ThemeToggle />
        <Link
          to="/settings"
          className="btn btn-ghost hidden h-9 w-9 p-0 sm:inline-flex"
          aria-label="Settings"
          title="Settings"
        >
          <Settings size={18} />
        </Link>
        <UserMenu />
      </div>
    </header>
  )
}
