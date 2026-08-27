/**
 * Typed fetch wrapper for the HEW ERP backend.
 *
 * `VITE_API_BASE` points at the Node backend. Business data is never persisted in
 * the browser; the Zustand store is an in-memory cache hydrated from this API.
 */

import { setStateVersion } from './stateVersion'

const BASE = (import.meta.env.VITE_API_BASE as string | undefined)?.replace(/\/$/, '') ?? ''
const TOKEN_KEY = 'hew_api_token'

export function apiEnabled(): boolean {
  return BASE !== ''
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}
export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token)
  else localStorage.removeItem(TOKEN_KEY)
}

export class ApiError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

interface RequestOpts {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Skip the bearer token (e.g. for login). */
  anonymous?: boolean
  signal?: AbortSignal
  /** Per-request timeout in ms (default 20s); the request aborts past it. */
  timeoutMs?: number
}

const DEFAULT_TIMEOUT = 20_000

async function request<T>(path: string, opts: RequestOpts = {}): Promise<T> {
  if (!apiEnabled()) throw new ApiError(0, 'API mode is disabled (VITE_API_BASE not set)')
  const token = opts.anonymous ? null : getToken()
  // Abort the fetch if it exceeds the timeout (or the caller's signal fires).
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT)
  if (opts.signal) opts.signal.addEventListener('abort', () => ctrl.abort(), { once: true })
  let res: Response
  try {
    res = await fetch(BASE + path, {
      method: opts.method ?? 'GET',
      headers: {
        'content-type': 'application/json',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: ctrl.signal,
    })
  } catch (e) {
    clearTimeout(timer)
    if (e instanceof DOMException && e.name === 'AbortError') throw new ApiError(0, 'Request timed out')
    throw new ApiError(0, 'Network error — could not reach the server')
  }
  clearTimeout(timer)
  // Track the server's state version (for optimistic-concurrency on snapshots).
  const ver = res.headers.get('x-state-version')
  if (ver != null && ver !== '') setStateVersion(Number(ver))
  let json: unknown = null
  try {
    json = await res.json()
  } catch {
    /* empty body */
  }
  if (!res.ok) {
    // 401 means the token is missing/expired/invalid (the backend uses 403 for
    // permission denials). Drop the stale token so the app falls back to /login.
    if (res.status === 401 && !opts.anonymous) setToken(null)
    const err = json as { error?: string; detail?: unknown } | null
    throw new ApiError(res.status, err?.error ?? `Request failed (${res.status})`, err?.detail)
  }
  return json as T
}

/** Most endpoints wrap their payload in `{ data }`; unwrap it for callers. */
async function requestData<T>(path: string, opts?: RequestOpts): Promise<T> {
  const out = await request<{ data: T }>(path, opts)
  return out.data
}

/** Fetch a binary endpoint (with the bearer token) and return an object URL for it. */
async function objectUrl(path: string): Promise<string> {
  const token = getToken()
  const res = await fetch(BASE + path, { headers: token ? { authorization: `Bearer ${token}` } : {} })
  if (!res.ok) throw new ApiError(res.status, `Could not load file (${res.status})`)
  return URL.createObjectURL(await res.blob())
}

export const api = {
  enabled: apiEnabled,
  raw: request,
  data: requestData,
  objectUrl,
  get: <T>(path: string) => requestData<T>(path),
  post: <T>(path: string, body?: unknown) => requestData<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => requestData<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => requestData<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => requestData<T>(path, { method: 'DELETE' }),
}
