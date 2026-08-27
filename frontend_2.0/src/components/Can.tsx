import type { ReactNode } from 'react'
import { useStore, currentUser } from '@/store'
import { can, type Action, type Module } from '@/types/rbac'

export interface CanProps {
  module: Module
  action: Action
  children: ReactNode
  /** Rendered when permission is denied (defaults to nothing). */
  fallback?: ReactNode
}

/**
 * The single client-side authorization gate (plan §2.7) — render `children`
 * only when the current user may `action` on `module`. Backed by the same
 * `can()` the command-bus enforces. For the hook form, see `@/hooks/useCan`.
 * NOTE: this hides UI; it is not security — the command-bus is the real
 * enforcement point (frontend-only app).
 */
export function Can({ module, action, children, fallback = null }: CanProps) {
  // Select the boolean (not the user) so a role-matrix edit — which changes what
  // can() returns without changing currentUser's reference — re-renders the gate.
  const allowed = useStore((s) => can(currentUser(s), module, action))
  return <>{allowed ? children : fallback}</>
}
