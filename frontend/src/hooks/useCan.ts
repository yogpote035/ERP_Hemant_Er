import { useCallback } from 'react'
import { useStore, currentUser } from '@/store'
import { can, type Action, type Module } from '@/types/rbac'

/**
 * Returns a `can(module, action)` checker bound to the current user — the same
 * `can()` the command-bus enforces, so UI affordances and write checks never
 * disagree. NOTE: this hides UI; it is not security. The command-bus is the real
 * enforcement point (frontend-only app).
 *
 * Subscribes to BOTH the user and that user's role matrix: editing a role mutates
 * `masters.roles` (not `masters.users`), so without the second subscription the
 * gates would keep a stale view (currentUser stays referentially equal) until a
 * reload. The role's `permissions` object ref changes only when that role is
 * edited, so there is no churn on unrelated state changes.
 */
export function useCan(): (module: Module, action: Action) => boolean {
  const user = useStore(currentUser)
  const rolePerms = useStore((s) => {
    const u = currentUser(s)
    return u ? s.masters.roles.byId[u.role]?.permissions : undefined
  })
  return useCallback((module: Module, action: Action) => can(user, module, action), [user, rolePerms])
}
