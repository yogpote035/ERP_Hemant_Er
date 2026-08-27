import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import type { Id, Normalized, User } from '@/types/domain'
import type { RoleDef } from '@/types/rbac'
import { seedRoleDefs, setRoleResolver } from '@/types/rbac'
import { quotaSafeStorage } from '@/lib/quotaStorage'
import { seedState, SEED_VERSION } from '@/lib/seed'
import { emptyCollection, getById, putEntity } from './normalized'
import {
  createEmptyState,
  pickPersisted,
  SCHEMA_VERSION,
  type PersistedState,
  type RootState,
} from './state'

export const PERSIST_KEY = 'hew-erp-v1'

/** The seed role registry as a normalized collection (built-ins). */
export function seedRolesCollection(): Normalized<RoleDef> {
  const c = emptyCollection<RoleDef>()
  seedRoleDefs().forEach((r) => putEntity(c, r))
  return c
}

export const useStore = create<RootState>()(
  persist(() => createEmptyState(), {
    name: PERSIST_KEY,
    version: SCHEMA_VERSION,
    storage: createJSONStorage(() => quotaSafeStorage),
    // Exclude session + undo/redo from persistence (plan §2.3).
    partialize: (s) => pickPersisted(s) as unknown as RootState,
    // v1 baseline — future migrations chain here and on backup import.
    migrate: (persisted) => persisted as RootState,
    merge: (persisted, current) => {
      // Persisted holds only data slices; keep the fresh session/undo from current.
      const p = (persisted ?? {}) as Partial<PersistedState>
      const merged = { ...current, ...p } as RootState
      // Backfill the role registry for stores persisted before roles were data.
      if (!merged.masters.roles || merged.masters.roles.allIds.length === 0) {
        merged.masters = { ...merged.masters, roles: seedRolesCollection() }
      }
      // Demo-data backfill: a store seeded before the current SEED_VERSION picks
      // up newer demo collections (expenses, rejection advices, rate masters) —
      // but ONLY where they are still empty, so a user's own data is never
      // clobbered. Runs once, then the bumped seedVersion stops it recurring.
      if (merged.system?.seeded && (merged.system.seedVersion ?? 0) < SEED_VERSION) {
        const fresh = seedState()
        if (merged.expenses.expenses.allIds.length === 0) merged.expenses = { expenses: fresh.expenses.expenses }
        if (merged.rejection.rejectionAdvices.allIds.length === 0) merged.rejection = { rejectionAdvices: fresh.rejection.rejectionAdvices }
        const masters = { ...merged.masters }
        if (masters.rmRates.allIds.length === 0) masters.rmRates = fresh.masters.rmRates
        if (masters.productionRates.allIds.length === 0) masters.productionRates = fresh.masters.productionRates
        merged.masters = masters
        merged.system = { ...merged.system, seedVersion: SEED_VERSION }
      }
      return merged
    },
  })
)

// Wire the live role resolver so editable + custom role matrices flow through the
// same can() used across the app (route guards, useCan, the command bus). Guard
// against a missing roles slice (e.g. an old backup) so it degrades to the static
// presets instead of throwing inside every can().
setRoleResolver((roleId) => {
  const roles = useStore.getState().masters.roles
  return roles ? getById(roles, roleId)?.permissions : undefined
})

// Multi-tab sync. Persisting to the shared localStorage key fires a 'storage' event in
// EVERY OTHER same-origin tab (never the writer). Without this each tab keeps a stale
// in-memory copy and the last to write silently clobbers the other's data. On the event
// we rehydrate so the tabs converge, then drop the undo/redo stacks — their immer patches
// were recorded against the pre-rehydrate tree and would mis-apply to the swapped-in one.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key !== PERSIST_KEY || e.newValue == null) return
    void Promise.resolve(useStore.persist.rehydrate()).then(() => {
      useStore.setState({ _undo: [], _redo: [] })
    })
  })
}

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

export function logout(): void {
  useStore.setState({ session: { currentUserId: null, currentUnitId: null } })
}

export function setActiveUnit(unitId: Id | 'ALL'): void {
  useStore.setState((s) => ({ session: { ...s.session, currentUnitId: unitId } }))
}

export type { RootState }
