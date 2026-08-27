import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { CommandValidationError } from './commands'
import { can, permits, type Role } from '@/types/rbac'
import { runCreateRole, runUpdateRolePermissions, runRenameRole, runDeleteRole, runResetRole } from './roleCommands'
import { runCreateUser } from './userCommands'

const st = () => useStore.getState()
const userByRole = (role: Role) => values(st().masters.users).find((u) => u.role === role)!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(userByRole('admin').id)
})

describe('role commands', () => {
  it('seeds the three built-in roles', () => {
    expect(values(st().masters.roles).map((r) => r.id).sort()).toEqual(['admin', 'manager', 'operator'])
    expect(getById(st().masters.roles, 'manager')!.builtIn).toBe(true)
  })

  it('creates a custom role (cloned), rejecting a case-insensitive duplicate name', () => {
    const id = runCreateRole({ name: 'Accountant', description: 'Finance', cloneFromId: 'operator' }).data.id
    const role = getById(st().masters.roles, id)!
    expect(role.builtIn).toBe(false)
    expect(permits(role.permissions, 'billing', 'view')).toBe(true) // cloned from operator preset
    expect(() => runCreateRole({ name: 'accountant' })).toThrow(CommandValidationError)
  })

  it('editing a role matrix changes what its users can do, through can()', () => {
    const id = runCreateRole({ name: 'Clerk' }).data.id // empty matrix
    const uid = runCreateUser({ name: 'Clerk One', email: 'clerk@hew.in', role: id, assignedUnitIds: ['u1'] }).data.id
    expect(can(getById(st().masters.users, uid)!, 'inward', 'view')).toBe(false)

    runUpdateRolePermissions({ id, permissions: { inward: ['view', 'create'] } })
    const clerk = getById(st().masters.users, uid)!
    expect(can(clerk, 'inward', 'view')).toBe(true)
    expect(can(clerk, 'inward', 'create')).toBe(true)
    expect(can(clerk, 'inward', 'delete')).toBe(false)
  })

  it('refuses to edit the admin role matrix', () => {
    expect(() => runUpdateRolePermissions({ id: 'admin', permissions: {} })).toThrow(CommandValidationError)
  })

  it('resets a built-in role to its preset', () => {
    runUpdateRolePermissions({ id: 'operator', permissions: { inward: ['view'] } })
    expect(permits(getById(st().masters.roles, 'operator')!.permissions, 'billing', 'view')).toBe(false)
    runResetRole('operator')
    expect(permits(getById(st().masters.roles, 'operator')!.permissions, 'billing', 'view')).toBe(true)
  })

  it('blocks deleting a built-in role or a custom role still in use; deletes an unused one', () => {
    expect(() => runDeleteRole('operator')).toThrow(CommandValidationError) // built-in
    const inUse = runCreateRole({ name: 'Temp' }).data.id
    runCreateUser({ name: 'Temp User', email: 'temp@hew.in', role: inUse, assignedUnitIds: ['u1'] })
    expect(() => runDeleteRole(inUse)).toThrow(CommandValidationError) // still assigned

    const unused = runCreateRole({ name: 'Empty' }).data.id
    runDeleteRole(unused)
    expect(getById(st().masters.roles, unused)).toBeUndefined()
  })

  it('renames a custom role but refuses to rename a built-in', () => {
    const id = runCreateRole({ name: 'Old' }).data.id
    runRenameRole({ id, name: 'New' })
    expect(getById(st().masters.roles, id)!.name).toBe('New')
    expect(() => runRenameRole({ id: 'manager', name: 'Boss' })).toThrow(CommandValidationError)
  })
})
