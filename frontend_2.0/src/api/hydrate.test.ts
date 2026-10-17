import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('./client', () => ({
  api: { get: vi.fn() },
}))

vi.mock('./modules', () => ({
  mastersApi: { list: vi.fn() },
}))

import { api } from './client'
import { mastersApi } from './modules'
import { hydrateViaModules } from './hydrate'
import { useStore } from '@/store'
import { createEmptyState } from '@/store/state'
import type { ApiUser } from './auth'

const manager: ApiUser = {
  id: 'manager-live',
  name: 'Live Manager',
  email: 'manager@example.com',
  role: 'manager',
  assignedUnitIds: ['u1'],
  active: true,
  createdAt: '2026-01-01',
  permissions: {
    dashboard: ['view'],
    masters: ['view'],
    rates: ['view'],
  },
}

beforeEach(() => {
  useStore.setState(createEmptyState(), true)
  vi.clearAllMocks()
  vi.mocked(mastersApi.list).mockResolvedValue([])
  vi.mocked(api.get).mockResolvedValue([])
})

describe('role-aware hydration', () => {
  it('does not request admin-only users/roles for a user without users:view', async () => {
    await hydrateViaModules(manager)

    const paths = vi.mocked(api.get).mock.calls.map(([path]) => path)
    expect(paths).not.toContain('/users')
    expect(paths).not.toContain('/roles')
    expect(useStore.getState().masters.users.byId[manager.id]).toMatchObject({
      id: manager.id,
      assignedUnitIds: ['u1'],
    })
    expect(useStore.getState().masters.roles.byId.manager?.permissions).toEqual(manager.permissions)
  })
})
