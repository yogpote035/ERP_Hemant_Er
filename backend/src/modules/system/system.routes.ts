/**
 * System module — admin-only backup/export, restore, and reset-demo.
 * Ported from frontend src/store/persistence.ts (backup envelope + structural
 * validation) and src/lib/seed.ts (seedState). Unlike the browser build, the
 * server is the single source of truth, so backup/restore operate directly on
 * the whole RootState via getDb()/replaceState() rather than a persisted subset.
 */
import { Router, type Request } from 'express'
import { getDb, replaceState, getVersion } from '../../db/repository.js'
import { seedState } from '../../db/seed.js'
import type { RootState } from '../../db/state.js'
import { authenticate } from '../../auth/middleware.js'
import { asyncHandler, badRequest, conflict, forbidden } from '../../lib/http.js'

/** The top-level slices every valid RootState backup must carry. */
const REQUIRED_SLICES = [
  'masters', 'inventory', 'billing', 'payments', 'scrap', 'expenses', 'rejection', 'hr', 'system',
] as const

/** Throw 403 unless the caller is an admin. */
function assertAdmin(req: Request): void {
  if (req.auth?.user.role !== 'admin') throw forbidden()
}

/**
 * Structural validation of an incoming backup state, mirroring the frontend's
 * validateBackup(): a plain object carrying every required slice. We accept the
 * bare RootState (what GET /backup returns) so a round-trip restore Just Works.
 */
function validateState(json: unknown): RootState {
  if (!json || typeof json !== 'object' || Array.isArray(json)) {
    throw badRequest('Backup state is not a JSON object')
  }
  const obj = json as Record<string, unknown>
  for (const k of REQUIRED_SLICES) {
    if (!(k in obj)) throw badRequest(`Backup is missing the "${k}" slice`)
  }
  return json as RootState
}

/**
 * The API strips `passwordHash` from every user it returns, so a snapshot the
 * client pushes back (write-through / undo reconcile) carries password-less users.
 * Replacing state verbatim would wipe every credential and lock everyone out — so
 * carry each existing user's hash forward when the incoming user lacks one.
 */
function preservePasswordHashes(current: RootState, next: RootState): void {
  const curUsers = current.masters?.users?.byId ?? {}
  const nextUsers = next.masters?.users?.byId as Record<string, { passwordHash?: string }> | undefined
  if (!nextUsers) return
  for (const [id, u] of Object.entries(nextUsers)) {
    if (u && !u.passwordHash && curUsers[id]?.passwordHash) u.passwordHash = curUsers[id].passwordHash
  }
}

export const systemRouter = Router()

systemRouter.use(authenticate)

/** GET /backup — admin only — full state JSON + the current state version. */
systemRouter.get(
  '/backup',
  asyncHandler(async (req, res) => {
    assertAdmin(req)
    res.json({ data: getDb(), version: getVersion() })
  })
)

/**
 * POST /backup { state, baseVersion? } — admin only — restore/replace the book.
 * Optimistic concurrency: when `baseVersion` is supplied and the server has moved
 * on since (another session wrote), reject with 409 so the client re-syncs instead
 * of silently clobbering the other session's changes.
 */
systemRouter.post(
  '/backup',
  asyncHandler(async (req, res) => {
    assertAdmin(req)
    const body = (req.body ?? {}) as { state?: unknown; baseVersion?: number }
    if (typeof body.baseVersion === 'number' && body.baseVersion !== getVersion()) {
      throw conflict('State changed in another session — reload before saving')
    }
    const next = validateState(body.state)
    preservePasswordHashes(getDb(), next) // never let a password-less snapshot wipe credentials
    await replaceState(next)
    res.json({ data: getDb(), version: getVersion(), cascade: ['state replaced from backup'] })
  })
)

/** POST /reset-demo — admin only — wipe to the deterministic demo seed. */
systemRouter.post(
  '/reset-demo',
  asyncHandler(async (req, res) => {
    assertAdmin(req)
    await replaceState(seedState())
    res.json({ data: getDb(), cascade: ['state reset to demo seed'] })
  })
)
