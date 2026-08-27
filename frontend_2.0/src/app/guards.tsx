import type { ReactNode } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { ShieldAlert } from 'lucide-react'
import { useStore, currentUser } from '@/store'
import { can, type Module } from '@/types/rbac'
import { EmptyState } from '@/components/ui'

/**
 * Auth gate. No signed-in user → bounce to /login, remembering where they were
 * headed so login can send them back. Used as a layout route around the app.
 */
export function RequireAuth() {
  const user = useStore(currentUser)
  const location = useLocation()
  // No session, or a user deactivated after login → back to /login. (can()
  // already denies an inactive actor; this also stops them seeing the shell.)
  if (!user || !user.active) {
    return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />
  }
  return <Outlet />
}

/** Full-page "no access" panel for a denied module. */
function NoAccess({ module }: { module: Module }) {
  return (
    <EmptyState
      icon={ShieldAlert}
      title="No access"
      description={`Your role doesn't include the “${module}” module. Ask an administrator if you need it.`}
    />
  )
}

/**
 * Permission gate for a single module. Wrap a route element with the module it
 * belongs to; the same `can()` the command-bus enforces decides visibility.
 */
export function RequirePermission({ module, children }: { module: Module; children: ReactNode }) {
  // Select the boolean so editing a role matrix (which doesn't change the user
  // reference) re-evaluates access and re-renders this gate without a reload.
  const allowed = useStore((s) => can(currentUser(s), module, 'view'))
  if (!allowed) return <NoAccess module={module} />
  return <>{children}</>
}
