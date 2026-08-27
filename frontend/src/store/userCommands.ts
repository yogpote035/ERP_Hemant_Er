/**
 * userCommands.ts (plan P8) — user management for the RBAC admin screens.
 * Create / update / activate-toggle / permission-override, all through the bus
 * (authorized via `can(actor,'users',…)`, atomic, undoable, logged). Includes
 * the lockout guards: never strip the last active admin and never let an admin
 * deactivate themselves.
 */
import type { Id, User } from '@/types/domain'
import { ACTIONS, BUILTIN_ROLE_IDS, MODULES } from '@/types/rbac'
import type { PermissionOverride, PermissionSet, Role, RoleId } from '@/types/rbac'
import { getById, patchEntity, putEntity, values } from './normalized'
import type { RootState } from './state'
import { runCommand, type Command } from './commandBus'
import type { CommandResult } from './commands'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function activeAdmins(s: RootState, exceptId?: Id): User[] {
  return values(s.masters.users).filter((u) => u.role === 'admin' && u.active && u.id !== exceptId)
}
function emailTaken(s: RootState, email: string, exceptId?: Id): boolean {
  const e = email.trim().toLowerCase()
  return values(s.masters.users).some((u) => u.id !== exceptId && u.email.trim().toLowerCase() === e)
}
function commonChecks(s: RootState, input: { name: string; email: string; role: RoleId; assignedUnitIds: Id[] }, exceptId: Id | undefined, errors: string[]) {
  if (!input.name.trim()) errors.push('Name is required')
  if (!EMAIL_RE.test(input.email.trim())) errors.push('A valid email is required')
  else if (emailTaken(s, input.email, exceptId)) errors.push(`Email ${input.email.trim()} is already in use`)
  const roleKnown = !!getById(s.masters.roles, input.role) || BUILTIN_ROLE_IDS.includes(input.role as Role)
  if (!roleKnown) errors.push('Invalid role')
  if (input.role !== 'admin' && input.assignedUnitIds.length === 0) {
    errors.push('Assign at least one unit for a non-admin user')
  }
  for (const u of input.assignedUnitIds) {
    if (!getById(s.masters.units, u)) errors.push('Assignment references an unknown unit')
  }
}

// ── create ─────────────────────────────────────────────────────────────────────
export interface CreateUserInput {
  name: string
  email: string
  role: RoleId
  assignedUnitIds: Id[]
  active?: boolean
}

const createCmd: Command<CreateUserInput, { id: Id }> = {
  name: 'createUser',
  module: 'users',
  action: 'create',
  validate(s, input) {
    const errors: string[] = []
    commonChecks(s, input, undefined, errors)
    return errors.length ? { ok: false, errors } : { ok: true }
  },
  apply(draft, input, ctx) {
    const id = ctx.newId('usr')
    const user: User = {
      id,
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role,
      assignedUnitIds: input.role === 'admin' ? [] : [...input.assignedUnitIds],
      active: input.active ?? true,
      createdAt: ctx.now,
      createdBy: ctx.actor.id,
    }
    putEntity(draft.masters.users, user)
    return {
      result: { id },
      cascade: [`User ${user.name} created`, `role ${user.role}`],
      summary: `Created user ${user.name} (${user.role})`,
      refs: [{ type: 'user', id }],
    }
  },
}
export function runCreateUser(input: CreateUserInput): CommandResult<{ id: Id }> {
  return runCommand(createCmd, input)
}

// ── update ─────────────────────────────────────────────────────────────────────
export interface UpdateUserInput {
  id: Id
  name: string
  email: string
  role: RoleId
  assignedUnitIds: Id[]
}

const updateCmd: Command<UpdateUserInput, { id: Id }> = {
  name: 'updateUser',
  module: 'users',
  action: 'edit',
  validate(s, input) {
    const errors: string[] = []
    const existing = getById(s.masters.users, input.id)
    if (!existing) return { ok: false, errors: ['User not found'] }
    commonChecks(s, input, input.id, errors)
    // Lockout guard: demoting the last active admin out of 'admin' is blocked.
    if (existing.role === 'admin' && input.role !== 'admin' && activeAdmins(s, input.id).length === 0) {
      errors.push('At least one active admin must remain')
    }
    return errors.length ? { ok: false, errors } : { ok: true }
  },
  apply(draft, input) {
    const existing = getById(draft.masters.users, input.id) as User
    patchEntity(draft.masters.users, input.id, {
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role,
      assignedUnitIds: input.role === 'admin' ? [] : [...input.assignedUnitIds],
    })
    return {
      result: { id: input.id },
      cascade: [`User ${input.name.trim()} updated`, `role ${input.role}`],
      summary: `Updated user ${existing.name}`,
      refs: [{ type: 'user', id: input.id }],
    }
  },
}
export function runUpdateUser(input: UpdateUserInput): CommandResult<{ id: Id }> {
  return runCommand(updateCmd, input)
}

// ── activate toggle ────────────────────────────────────────────────────────────
const toggleCmd: Command<{ id: Id }, { id: Id; active: boolean }> = {
  name: 'toggleUserActive',
  module: 'users',
  action: 'edit',
  validate(s, input, ctx) {
    const u = getById(s.masters.users, input.id)
    if (!u) return { ok: false, errors: ['User not found'] }
    if (u.active) {
      // Deactivating — guard self + last-admin lockout.
      if (ctx.actor.id === u.id) return { ok: false, errors: ['You cannot deactivate your own account'] }
      if (u.role === 'admin' && activeAdmins(s, u.id).length === 0) {
        return { ok: false, errors: ['At least one active admin must remain'] }
      }
    }
    return { ok: true }
  },
  apply(draft, input) {
    const u = getById(draft.masters.users, input.id) as User
    const active = !u.active
    patchEntity(draft.masters.users, input.id, { active })
    return {
      result: { id: input.id, active },
      cascade: [`${u.name} ${active ? 'activated' : 'deactivated'}`],
      summary: `${active ? 'Activated' : 'Deactivated'} user ${u.name}`,
      refs: [{ type: 'user', id: input.id }],
    }
  },
}
export function runToggleUserActive(id: Id): CommandResult<{ id: Id; active: boolean }> {
  return runCommand(toggleCmd, { id })
}

// ── permission override ──────────────────────────────────────────────────────
export interface SetOverrideInput {
  id: Id
  overrides?: PermissionOverride
}

const overrideCmd: Command<SetOverrideInput, { id: Id }> = {
  name: 'setUserOverride',
  module: 'users',
  action: 'edit',
  validate(s, input) {
    const u = getById(s.masters.users, input.id)
    if (!u) return { ok: false, errors: ['User not found'] }
    if (u.role === 'admin') return { ok: false, errors: ['Admins already have every permission'] }
    return { ok: true }
  },
  apply(draft, input) {
    const u = getById(draft.masters.users, input.id) as User
    const empty =
      !input.overrides ||
      ((!input.overrides.add || Object.keys(input.overrides.add).length === 0) &&
        (!input.overrides.remove || Object.keys(input.overrides.remove).length === 0))
    patchEntity(draft.masters.users, input.id, { overrides: empty ? undefined : input.overrides })
    return {
      result: { id: input.id },
      cascade: [empty ? `${u.name}: reset to ${u.role} defaults` : `${u.name}: custom permissions saved`],
      summary: `Set permissions for ${u.name}`,
      refs: [{ type: 'user', id: input.id }],
    }
  },
}
export function runSetUserOverride(input: SetOverrideInput): CommandResult<{ id: Id }> {
  return runCommand(overrideCmd, input)
}

// ── shared helper: derive override deltas from a desired effective grid ─────────
/**
 * Given the role's preset perms and the desired enabled cells ("module:action"),
 * compute the minimal `add`/`remove` override deltas. Drives the matrix UI.
 */
export function diffOverride(preset: PermissionSet, desired: Set<string>): PermissionOverride {
  const add: PermissionSet = {}
  const remove: PermissionSet = {}
  for (const m of MODULES) {
    for (const a of ACTIONS) {
      const presetHas = preset[m]?.includes(a) ?? false
      const want = desired.has(`${m}:${a}`)
      if (want && !presetHas) (add[m] = add[m] ?? []).push(a)
      else if (!want && presetHas) (remove[m] = remove[m] ?? []).push(a)
    }
  }
  const out: PermissionOverride = {}
  if (Object.keys(add).length) out.add = add
  if (Object.keys(remove).length) out.remove = remove
  return out
}
