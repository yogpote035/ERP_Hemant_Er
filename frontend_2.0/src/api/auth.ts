/** Auth API calls — login/me. Used by the integration layer when API mode is on. */
import { api, setToken } from './client'
import type { Action, Module } from '@/types/rbac'

export interface ApiUser {
  id: string
  name: string
  email: string
  role: string
  assignedUnitIds: string[]
  active: boolean
  createdAt: string
  permissions: Partial<Record<Module, Action[]>>
}

export async function apiLogin(email: string, password: string): Promise<ApiUser> {
  const res = await api.raw<{ token: string; user: ApiUser }>('/auth/login', {
    method: 'POST',
    body: { email, password },
    anonymous: true,
  })
  setToken(res.token)
  return res.user
}

export async function apiMe(): Promise<ApiUser> {
  const res = await api.raw<{ user: ApiUser }>('/auth/me')
  return res.user
}

export function apiLogout(): void {
  setToken(null)
}
