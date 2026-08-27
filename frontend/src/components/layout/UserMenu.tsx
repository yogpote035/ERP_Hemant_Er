import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, UserCircle2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore, currentUser, logout } from '@/store'
import { useOnClickOutside } from '@/hooks/useOnClickOutside'
import { Badge, type BadgeTone } from '@/components/ui'

const ROLE_TONE: Record<string, BadgeTone> = {
  admin: 'primary',
  manager: 'success',
  operator: 'muted',
}

/** Avatar + name button that opens a small menu with the role and Sign out. */
export function UserMenu() {
  const user = useStore(currentUser)
  const roleName = useStore((s) => {
    const u = currentUser(s)
    return u ? s.masters.roles.byId[u.role]?.name ?? u.role : ''
  })
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  useOnClickOutside(ref, () => setOpen(false), open)

  // Escape closes the menu and returns focus to the trigger (keyboard users).
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open])

  if (!user) return null

  const initials = user.name
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? '')
    .join('')

  function signOut() {
    logout()
    toast.success('Signed out')
    navigate('/login', { replace: true })
  }

  return (
    <div className="relative" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="btn btn-ghost h-9 gap-2 px-2"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <span className="flex h-7 w-7 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
          {initials || <UserCircle2 size={16} />}
        </span>
        <span className="hidden text-sm font-medium sm:inline">{user.name}</span>
        <ChevronDown size={15} className="text-muted-fg" />
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-60 rounded-xl border border-border bg-card p-1.5 text-card-fg shadow-xl"
        >
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-semibold">{user.name}</div>
            <div className="truncate text-xs text-muted">{user.email}</div>
            <div className="mt-1.5">
              <Badge tone={ROLE_TONE[user.role] ?? 'warning'}>
                {roleName}
              </Badge>
            </div>
          </div>
          <div className="my-1 border-t border-border" />
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm text-danger hover:bg-danger/10"
          >
            <LogOut size={16} />
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  )
}
