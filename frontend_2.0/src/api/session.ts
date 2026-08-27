/**
 * API-mode session glue. Logs in against the backend, hydrates the store (admin
 * gets the full book via /system/backup; other roles read what's loaded), then
 * opens the local scoped session via the existing store `login(id)`.
 *
 * Demo user ids are identical in the frontend seed and the backend seed, so
 * `login(user.id)` resolves whether or not hydration ran.
 */
import { apiLogin, apiLogout, apiMe, type ApiUser } from './auth'
import { apiEnabled, getToken, setToken } from './client'
import { hydrateViaModules } from './hydrate'
import { installWriteThrough } from './writeThrough'
import { login, logout } from '@/store'

/** Hydrate the store from the per-module GET endpoints (every role, scoped server-side). */
async function hydrateFor(_user: ApiUser): Promise<void> {
  try {
    await hydrateViaModules()
  } catch {
    /* keep going with whatever is loaded */
  }
}

export async function loginViaApi(loginId: string, password: string): Promise<ApiUser> {
  const user = await apiLogin(loginId, password)
  // Hydrate the store from the backend so every page shows real data. Admin gets the
  // whole book in one snapshot (includes the system slice); other roles assemble it
  // from the scoped module GET endpoints.
  await hydrateFor(user)
  installWriteThrough() // mirror subsequent local commands to the backend
  login(user.id)
  return user
}

/**
 * Restore an API session on app boot/reload. The session itself is in-memory (lost
 * on reload), but the bearer token persists — so re-validate it via /auth/me, then
 * re-hydrate + reopen the session. Returns false (and clears a dead token) when API
 * mode is off, there's no token, or the token is expired/invalid.
 */
export async function restoreApiSession(): Promise<boolean> {
  if (!apiEnabled() || !getToken()) return false
  try {
    const user = await apiMe() // 401 ⇒ client clears the token + throws
    await hydrateFor(user)
    installWriteThrough()
    login(user.id)
    return true
  } catch {
    setToken(null)
    return false
  }
}

export function logoutViaApi(): void {
  apiLogout()
  logout()
}
