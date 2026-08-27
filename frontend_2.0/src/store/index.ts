import { create } from 'zustand'
import type { Id, Normalized, User } from '@/types/domain'
import type { RoleDef } from '@/types/rbac'
import { seedRoleDefs, setRoleResolver } from '@/types/rbac'
import { emptyCollection, getById, putEntity, values } from './normalized'
import { createEmptyState, type RootState } from './state'

/** The seed role registry as a normalized collection (built-ins). */
export function seedRolesCollection(): Normalized<RoleDef> {
  const c = emptyCollection<RoleDef>()
  seedRoleDefs().forEach((r) => putEntity(c, r))
  return c
}

/** In-memory UI cache hydrated from the API. PostgreSQL is the only business-data
 * persistence layer; refreshing the page discards this cache and hydrates again. */
export const useStore = create<RootState>()(() => createEmptyState())

// Wire the live role resolver so editable + custom role matrices flow through the
// same can() used across the app (route guards, useCan, the command bus). Guard
// against a missing roles slice (e.g. an old backup) so it degrades to the static
// presets instead of throwing inside every can().
setRoleResolver((roleId) => {
  const roles = useStore.getState().masters.roles
  return roles ? getById(roles, roleId)?.permissions : undefined
})

// ── Session helpers (the only "actions" on the raw store) ────────────────────

export function currentUser(s: RootState): User | null {
  return getById(s.masters.users, s.session.currentUserId) ?? null
}

/** Resolve a stale persisted activeUnit to a valid one for the user. */
function healUnit(user: User, prev: Id | 'ALL' | null): Id | 'ALL' {
  if (user.role === 'admin') return prev ?? 'ALL'
  if (prev && prev !== 'ALL' && user.assignedUnitIds.includes(prev)) return prev
  return user.assignedUnitIds[0] ?? 'ALL'
}

export function login(userId: Id): void {
  useStore.setState((s) => {
    const user = getById(s.masters.users, userId)
    if (!user || !user.active) return s
    return {
      session: { currentUserId: user.id, currentUnitId: healUnit(user, s.session.currentUnitId) },
    }
  })
}

/** Credential sign-in: match an ACTIVE user by Login ID (email, case-insensitive)
 *  + password, then open their scoped session. Returns the user, or an error code
 *  the login screen turns into a message. Access (admin vs unit-scoped) follows
 *  from the matched user's role + assignedUnitIds via `can()` and the unit scope. */
export type LoginResult = { ok: true; user: User } | { ok: false; reason: 'not_found' | 'bad_password' | 'inactive' }
export function loginWithCredentials(loginId: string, password: string): LoginResult {
  const id = loginId.trim().toLowerCase()
  const user = values(useStore.getState().masters.users).find((u) => u.email.toLowerCase() === id)
  if (!user) return { ok: false, reason: 'not_found' }
  if (!user.active) return { ok: false, reason: 'inactive' }
  if ((user.password ?? '') !== password) return { ok: false, reason: 'bad_password' }
  login(user.id)
  return { ok: true, user }
}

export function logout(): void {
  useStore.setState({ session: { currentUserId: null, currentUnitId: null } })
}

export function setActiveUnit(unitId: Id | 'ALL'): void {
  useStore.setState((s) => ({ session: { ...s.session, currentUnitId: unitId } }))
}

export type { RootState }
