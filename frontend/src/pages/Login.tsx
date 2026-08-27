import { useMemo } from 'react'
import { Navigate, useLocation, useNavigate } from 'react-router-dom'
import { Boxes, ChevronRight, Info } from 'lucide-react'
import { useStore, currentUser, login } from '@/store'
import { values } from '@/store/normalized'
import { Badge, type BadgeTone } from '@/components/ui'
import type { User } from '@/types/domain'

const ROLE_TONE: Record<string, BadgeTone> = { admin: 'primary', manager: 'success', operator: 'muted' }

/**
 * Mock login (frontend-only): pick a seeded user to sign in as. Passwords are
 * not verified — this is a demo identity switch, not real auth. The real
 * enforcement is the command-bus + `can()`.
 */
export default function Login() {
  const user = useStore(currentUser)
  const usersColl = useStore((s) => s.masters.users)
  const users = useMemo(() => values(usersColl).filter((u) => u.active), [usersColl])
  const unitsById = useStore((s) => s.masters.units.byId)
  const rolesById = useStore((s) => s.masters.roles.byId)
  const navigate = useNavigate()
  const location = useLocation()
  const from = (location.state as { from?: string } | null)?.from ?? '/'

  // Already signed in → straight to the app.
  if (user) return <Navigate to="/" replace />

  function signInAs(u: User) {
    login(u.id)
    navigate(from, { replace: true })
  }

  function unitLabel(u: User): string {
    if (u.role === 'admin') return 'All units'
    return u.assignedUnitIds.map((id) => unitsById[id]?.code ?? id).join(', ') || '—'
  }

  return (
    <div className="flex min-h-full items-center justify-center bg-bg p-4">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/15 text-primary">
            <Boxes size={26} />
          </span>
          <h1 className="text-xl font-bold">Hemant Engineering Works</h1>
          <p className="text-sm text-muted">Job Work Management &amp; Billing ERP</p>
        </div>

        <div className="card">
          <h2 className="text-sm font-semibold">Choose a profile to sign in</h2>
          <ul className="mt-3 space-y-2">
            {users.map((u) => (
              <li key={u.id}>
                <button
                  type="button"
                  onClick={() => signInAs(u)}
                  className="group flex w-full items-center gap-3 rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-primary hover:bg-primary/5"
                >
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-primary/15 text-xs font-semibold text-primary">
                    {u.name
                      .split(/\s+/)
                      .slice(0, 2)
                      .map((w) => w[0]?.toUpperCase() ?? '')
                      .join('')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{u.name}</span>
                    <span className="block truncate text-xs text-muted">{unitLabel(u)}</span>
                  </span>
                  <Badge tone={ROLE_TONE[u.role] ?? 'warning'}>
                    {rolesById[u.role]?.name ?? u.role}
                  </Badge>
                  <ChevronRight size={16} className="text-muted-fg transition-transform group-hover:translate-x-0.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>

        <p className="mt-4 flex items-center justify-center gap-1.5 text-xs text-muted">
          <Info size={13} />
          Demo mode — passwords aren&apos;t checked; data lives in your browser.
        </p>
      </div>
    </div>
  )
}
