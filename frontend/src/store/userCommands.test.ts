import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { CommandValidationError } from './commands'
import { effectivePermissions, permits, MODULES, ACTIONS, type Role } from '@/types/rbac'
import {
  runCreateUser,
  runUpdateUser,
  runToggleUserActive,
  runSetUserOverride,
  diffOverride,
} from './userCommands'

const st = () => useStore.getState()
const userByRole = (role: Role) => values(st().masters.users).find((u) => u.role === role)!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(userByRole('admin').id)
})

describe('createUser / updateUser', () => {
  it('creates a user, rejecting a duplicate email and a unit-less non-admin', () => {
    const id = runCreateUser({ name: 'New Op', email: 'newop@hew.in', role: 'operator', assignedUnitIds: ['u1'] }).data.id
    expect(getById(st().masters.users, id)!.email).toBe('newop@hew.in')
    // duplicate email
    expect(() => runCreateUser({ name: 'Dup', email: 'newop@hew.in', role: 'operator', assignedUnitIds: ['u1'] })).toThrow(CommandValidationError)
    // non-admin with no units
    expect(() => runCreateUser({ name: 'NoUnit', email: 'x@hew.in', role: 'manager', assignedUnitIds: [] })).toThrow(CommandValidationError)
  })

  it('blocks demoting the last active admin', () => {
    const admin = userByRole('admin')
    expect(() => runUpdateUser({ id: admin.id, name: admin.name, email: admin.email, role: 'manager', assignedUnitIds: ['u1'] })).toThrow(
      CommandValidationError
    )
  })
})

describe('toggleUserActive', () => {
  it('refuses to deactivate your own account', () => {
    const admin = userByRole('admin')
    expect(() => runToggleUserActive(admin.id)).toThrow(CommandValidationError)
  })

  it('deactivates and reactivates another user', () => {
    const op = userByRole('operator')
    expect(runToggleUserActive(op.id).data.active).toBe(false)
    expect(getById(st().masters.users, op.id)!.active).toBe(false)
    expect(runToggleUserActive(op.id).data.active).toBe(true)
  })
})

describe('permission overrides', () => {
  it('grants an extra action via override, then resets to the role preset', () => {
    const id = runCreateUser({ name: 'Grantee', email: 'g@hew.in', role: 'operator', assignedUnitIds: ['u1'] }).data.id
    const preset = effectivePermissions('operator')
    expect(permits(preset, 'inward', 'delete')).toBe(false)

    // desired = preset + inward:delete
    const desired = new Set<string>()
    for (const m of MODULES) for (const a of ACTIONS) if (permits(preset, m, a)) desired.add(`${m}:${a}`)
    desired.add('inward:delete')
    runSetUserOverride({ id, overrides: diffOverride(preset, desired) })

    const u = getById(st().masters.users, id)!
    expect(u.overrides?.add?.inward).toContain('delete')
    expect(permits(effectivePermissions(u.role, u.overrides), 'inward', 'delete')).toBe(true)

    // reset: desired === preset → empty override → cleared
    const presetSet = new Set<string>()
    for (const m of MODULES) for (const a of ACTIONS) if (permits(preset, m, a)) presetSet.add(`${m}:${a}`)
    runSetUserOverride({ id, overrides: diffOverride(preset, presetSet) })
    expect(getById(st().masters.users, id)!.overrides).toBeUndefined()
  })

  it('refuses overrides on an admin (already full access)', () => {
    const admin = userByRole('admin')
    expect(() => runSetUserOverride({ id: admin.id, overrides: { remove: { billing: ['delete'] } } })).toThrow(CommandValidationError)
  })
})
