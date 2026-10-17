import { afterEach, describe, expect, it, vi } from 'vitest'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('API session expiry', () => {
  it('clears the token and announces a non-anonymous 401', async () => {
    vi.stubEnv('VITE_API_BASE', '/api')
    const { api, getToken, setToken, UNAUTHORIZED_EVENT } = await import('./client')
    setToken('expired-token')
    const expired = vi.fn()
    window.addEventListener(UNAUTHORIZED_EVENT, expired, { once: true })
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(
      JSON.stringify({ error: 'expired' }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    )))

    await expect(api.get('/protected')).rejects.toMatchObject({ status: 401 })
    expect(getToken()).toBeNull()
    expect(expired).toHaveBeenCalledTimes(1)
  })
})
