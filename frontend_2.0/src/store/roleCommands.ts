/**
 * roleCommands.ts — role management for the Roles & Permissions module.
 * Roles are editable store data (masters.roles): the three built-ins seed from
 * ROLE_PRESETS and can be re-tuned or reset, and admins can add custom roles.
 * Everything runs through the bus (authorized via `can(actor,'users',…)`, atomic,
 * undoable, logged) — the SAME `can()` route guards + the bus enforce, so a role
 * matrix edit instantly changes what every assigned user can do.
 *
 * Guards: the built-in `admin` role is matrix-locked (always full access) and no
 * built-in role can be deleted; a custom role can't be deleted while users hold it.
 */
import type { Id } from '@/types/domain'
import {
  ROLE_PRESETS,
  clonePermissions,
  permits,
  ACTIONS,
  MODULES,
  type PermissionSet,
  type Role,
  type RoleDef,
} from '@/types/rbac'
import { getById, putEntity, removeEntity, values } from './normalized'
import type { RootState } from './state'
import { runCommand, type Command } from './commandBus'
import type { CommandResult } from './commands'

function nameTaken(s: RootState, name: string, exceptId?: Id): boolean {
  const n = name.trim().toLowerCase()
  return values(s.masters.roles).some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === n)
}
function usersWithRole(s: RootState, roleId: Id): number {
  return values(s.masters.users).filter((u) => u.role === roleId).length
}
/** Keep only known module:action pairs (defends the matrix against junk input). */
function sanitize(perms: PermissionSet): PermissionSet {
  const out: PermissionSet = {}
  for (const m of MODULES) {
    const acts = ACTIONS.filter((a) => permits(perms, m, a))
    if (acts.length) out[m] = acts
  }
  return out
}

// ── create custom role ───────────────────────────────────────────────────────
export interface CreateRoleInput {
  name: string
  description?: string
  /** Clone this role's matrix as the starting point (else start empty). */
  cloneFromId?: Id
}

const createCmd: Command<CreateRoleInput, { id: Id }> = {
  name: 'createRole',
  module: 'users',
  action: 'create',
  validate(s, input) {
    const errors: string[] = []
    if (!input.name.trim()) errors.push('Role name is required')
    else if (nameTaken(s, input.name)) errors.push(`A role named “${input.name.trim()}” already exists`)
    if (input.cloneFromId && !getById(s.masters.roles, input.cloneFromId)) errors.push('Clone source role not found')
    return errors.length ? { ok: false, errors } : { ok: true }
  },
  apply(draft, input, ctx) {
    const id = ctx.newId('role')
    const src = input.cloneFromId ? getById(draft.masters.roles, input.cloneFromId) : undefined
    const role: RoleDef = {
      id,
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      builtIn: false,
      permissions: src ? clonePermissions(src.permissions) : {},
    }
    putEntity(draft.masters.roles, role)
    return {
      result: { id },
      cascade: [`Role ${role.name} created`, src ? `cloned from ${src.name}` : 'empty matrix'],
      summary: `Created role ${role.name}`,
      refs: [{ type: 'role', id }],
    }
  },
}
export function runCreateRole(input: CreateRoleInput): CommandResult<{ id: Id }> {
  return runCommand(createCmd, input)
}

// ── edit a role's permission matrix ────────────────────────────────────────────
export interface UpdateRolePermissionsInput {
  id: Id
  permissions: PermissionSet
}

const updatePermsCmd: Command<UpdateRolePermissionsInput, { id: Id }> = {
  name: 'updateRolePermissions',
  module: 'users',
  action: 'edit',
  validate(s, input) {
    const role = getById(s.masters.roles, input.id)
    if (!role) return { ok: false, errors: ['Role not found'] }
    if (role.id === 'admin') return { ok: false, errors: ['The Admin role always has full access and cannot be edited'] }
    return { ok: true }
  },
  apply(draft, input) {
    const role = getById(draft.masters.roles, input.id) as RoleDef
    patchRolePermissions(draft, input.id, sanitize(input.permissions))
    return {
      result: { id: input.id },
      cascade: [`Permissions updated for ${role.name}`],
      summary: `Updated permissions for role ${role.name}`,
      refs: [{ type: 'role', id: input.id }],
    }
  },
}
export function runUpdateRolePermissions(input: UpdateRolePermissionsInput): CommandResult<{ id: Id }> {
  return runCommand(updatePermsCmd, input)
}

// ── rename / re-describe a role ────────────────────────────────────────────────
export interface RenameRoleInput {
  id: Id
  name: string
  description?: string
}

const renameCmd: Command<RenameRoleInput, { id: Id }> = {
  name: 'renameRole',
  module: 'users',
  action: 'edit',
  validate(s, input) {
    const role = getById(s.masters.roles, input.id)
    if (!role) return { ok: false, errors: ['Role not found'] }
    if (role.builtIn) return { ok: false, errors: ['Built-in roles cannot be renamed'] }
    if (!input.name.trim()) return { ok: false, errors: ['Role name is required'] }
    if (nameTaken(s, input.name, input.id)) return { ok: false, errors: [`A role named “${input.name.trim()}” already exists`] }
    return { ok: true }
  },
  apply(draft, input) {
    const role = getById(draft.masters.roles, input.id) as RoleDef
    putEntity(draft.masters.roles, { ...role, name: input.name.trim(), description: input.description?.trim() || undefined })
    return {
      result: { id: input.id },
      cascade: [`Role renamed to ${input.name.trim()}`],
      summary: `Renamed role ${role.name} → ${input.name.trim()}`,
      refs: [{ type: 'role', id: input.id }],
    }
  },
}
export function runRenameRole(input: RenameRoleInput): CommandResult<{ id: Id }> {
  return runCommand(renameCmd, input)
}

// ── delete a custom role ───────────────────────────────────────────────────────
const deleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteRole',
  module: 'users',
  action: 'delete',
  validate(s, input) {
    const role = getById(s.masters.roles, input.id)
    if (!role) return { ok: false, errors: ['Role not found'] }
    if (role.builtIn) return { ok: false, errors: ['Built-in roles cannot be deleted'] }
    const n = usersWithRole(s, input.id)
    if (n > 0) return { ok: false, errors: [`${n} user(s) still have this role — reassign them first`] }
    return { ok: true }
  },
  apply(draft, input) {
    const role = getById(draft.masters.roles, input.id) as RoleDef
    removeEntity(draft.masters.roles, input.id)
    return {
      result: { id: input.id },
      cascade: [`Role ${role.name} deleted`],
      summary: `Deleted role ${role.name}`,
      refs: [{ type: 'role', id: input.id }],
    }
  },
}
export function runDeleteRole(id: Id): CommandResult<{ id: Id }> {
  return runCommand(deleteCmd, { id })
}

// ── reset a built-in role to its preset ────────────────────────────────────────
const resetCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'resetRole',
  module: 'users',
  action: 'edit',
  validate(s, input) {
    const role = getById(s.masters.roles, input.id)
    if (!role) return { ok: false, errors: ['Role not found'] }
    if (!role.builtIn) return { ok: false, errors: ['Only built-in roles can be reset'] }
    return { ok: true }
  },
  apply(draft, input) {
    const role = getById(draft.masters.roles, input.id) as RoleDef
    patchRolePermissions(draft, input.id, clonePermissions(ROLE_PRESETS[input.id as Role]))
    return {
      result: { id: input.id },
      cascade: [`${role.name} reset to defaults`],
      summary: `Reset role ${role.name} to preset`,
      refs: [{ type: 'role', id: input.id }],
    }
  },
}
export function runResetRole(id: Id): CommandResult<{ id: Id }> {
  return runCommand(resetCmd, { id })
}

/** Immutably replace a role's permission matrix on the draft. */
function patchRolePermissions(draft: RootState, id: Id, permissions: PermissionSet): void {
  const role = getById(draft.masters.roles, id) as RoleDef
  putEntity(draft.masters.roles, { ...role, permissions })
}
