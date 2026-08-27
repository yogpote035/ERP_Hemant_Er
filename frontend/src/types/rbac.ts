/**
 * RBAC — the SINGLE source of truth for modules, actions, roles and presets.
 * Route guards, the <Can> gate / useCan hook, and (defense-in-depth) the store
 * command-bus all go through `can()`. Kept dependency-free so domain.ts can
 * import these types without a cycle.
 */

export const MODULES = [
  'dashboard',
  'inward',
  'dispatch',
  'stock',
  'billing',
  'payments',
  'scrap',
  'rejection',
  'expenses',
  'attendance',
  'masters',
  'rates',
  'reports',
  'users',
  'import',
] as const
export type Module = (typeof MODULES)[number]

export const ACTIONS = ['view', 'create', 'edit', 'delete', 'export', 'approve'] as const
export type Action = (typeof ACTIONS)[number]

export type Role = 'admin' | 'manager' | 'operator'
/** A role identifier: a built-in `Role` or a custom role's generated id. */
export type RoleId = string
/** Built-in role ids (seeded, resettable; 'admin' is always full access). */
export const BUILTIN_ROLE_IDS: Role[] = ['admin', 'manager', 'operator']

export type PermissionSet = Partial<Record<Module, Action[]>>

/** Per-user override deltas on top of the role preset. `remove` wins on conflict. */
export interface PermissionOverride {
  add?: PermissionSet
  remove?: PermissionSet
}

const ALL: Action[] = [...ACTIONS]
const OPS_FULL: Action[] = ['view', 'create', 'edit', 'export']

function preset(entries: Partial<Record<Module, Action[]>>): PermissionSet {
  return entries
}

/**
 * Role presets:
 *  - admin    — every action on every module (incl. user management).
 *  - manager  — all operational modules; may edit rate-master; NO user mgmt; no hard deletes on rates.
 *  - operator — data entry only (view/create/edit/export); NO delete; rates view-only; no user mgmt.
 */
export const ROLE_PRESETS: Record<Role, PermissionSet> = {
  admin: Object.fromEntries(MODULES.map((m) => [m, ALL])) as PermissionSet,
  manager: preset({
    dashboard: ['view', 'export'],
    inward: ALL,
    dispatch: ALL,
    stock: ['view', 'export'],
    billing: ['view', 'create', 'edit', 'export', 'approve'],
    payments: ['view', 'create', 'edit'],
    scrap: ['view', 'create', 'edit', 'export'],
    rejection: ['view', 'create', 'edit'],
    expenses: ['view', 'create', 'edit', 'export'],
    attendance: ['view', 'create', 'edit', 'export'],
    masters: ['view', 'create', 'edit'],
    rates: ['view', 'create', 'edit'],
    reports: ['view', 'export'],
    import: ['view', 'create'],
  }),
  operator: preset({
    dashboard: ['view'],
    inward: OPS_FULL,
    dispatch: OPS_FULL,
    stock: ['view'],
    billing: ['view', 'create'],
    payments: ['view', 'create'],
    scrap: ['view', 'create'],
    rejection: ['view', 'create'],
    expenses: ['view', 'create'],
    attendance: ['view', 'create', 'edit'],
    masters: ['view'],
    rates: ['view'],
    reports: ['view', 'export'],
    import: ['view'],
  }),
}

/** A role as stored/edited at runtime (built-in seeds + custom roles). */
export interface RoleDef {
  id: RoleId
  name: string
  description?: string
  /** Built-ins can be reset but not deleted; 'admin' is also matrix-locked. */
  builtIn: boolean
  permissions: PermissionSet
}

const BUILTIN_ROLE_META: Record<Role, { name: string; description: string }> = {
  admin: { name: 'Admin', description: 'Full access to every module, all units and user management.' },
  manager: { name: 'Manager', description: 'Runs operations end-to-end incl. invoice approval; no user management.' },
  operator: { name: 'Operator', description: 'Data entry: view / create / edit; no deletes, no user management.' },
}

/** Copy a PermissionSet (arrays cloned) so edits never alias the source. */
export function clonePermissions(p: PermissionSet): PermissionSet {
  const out: PermissionSet = {}
  for (const [m, acts] of Object.entries(p) as [Module, Action[]][]) out[m] = [...acts]
  return out
}

/** The seed role registry — the three built-ins derived from ROLE_PRESETS. */
export function seedRoleDefs(): RoleDef[] {
  return BUILTIN_ROLE_IDS.map((id) => ({
    id,
    name: BUILTIN_ROLE_META[id].name,
    description: BUILTIN_ROLE_META[id].description,
    builtIn: true,
    permissions: clonePermissions(ROLE_PRESETS[id]),
  }))
}

// ── Live role resolver ───────────────────────────────────────────────────────
// The store wires this so editable + custom role matrices flow through the SAME
// can() the whole app uses. Falls back to the static presets when unset
// (seeds / tests / before the store mounts) and for built-in ids.
let roleResolver: ((roleId: RoleId) => PermissionSet | undefined) | null = null
export function setRoleResolver(fn: ((roleId: RoleId) => PermissionSet | undefined) | null): void {
  roleResolver = fn
}
function basePermissions(role: RoleId): PermissionSet {
  return roleResolver?.(role) ?? ROLE_PRESETS[role as Role] ?? {}
}

const uniq = (xs: Action[]): Action[] => Array.from(new Set(xs))

/** Expand a role's base matrix and apply per-user override deltas. */
export function effectivePermissions(role: RoleId, overrides?: PermissionOverride): PermissionSet {
  const base: PermissionSet = {}
  for (const [m, acts] of Object.entries(basePermissions(role)) as [Module, Action[]][]) {
    base[m] = [...acts]
  }
  if (overrides?.add) {
    for (const [m, acts] of Object.entries(overrides.add) as [Module, Action[]][]) {
      base[m] = uniq([...(base[m] ?? []), ...acts])
    }
  }
  if (overrides?.remove) {
    for (const [m, acts] of Object.entries(overrides.remove) as [Module, Action[]][]) {
      base[m] = (base[m] ?? []).filter((a) => !acts.includes(a))
    }
  }
  return base
}

/** Does this effective permission set allow `action` on `module`? */
export function permits(perms: PermissionSet, module: Module, action: Action): boolean {
  return perms[module]?.includes(action) ?? false
}

/** Minimal actor shape `can()` needs (the full User lives in domain.ts). */
export interface PermissionActor {
  role: RoleId
  overrides?: PermissionOverride
  active: boolean
}

/** The one authorization check used across the app. Deactivated => denied. */
export function can(actor: PermissionActor | null | undefined, module: Module, action: Action): boolean {
  if (!actor || !actor.active) return false
  // Admin is the super-role: always full access. This keeps the "an admin can
  // never lock themselves out" invariant even though role matrices are editable,
  // and auto-grants any module/action added in a future release (including on a
  // store persisted before that release, whose admin matrix is frozen).
  if (actor.role === 'admin') return true
  return permits(effectivePermissions(actor.role, actor.overrides), module, action)
}
