import type { NextFunction, Request, Response } from 'express'
import { getDb, getById } from '../db/repository.js'
import { can, type Action, type Module } from '../types/rbac.js'
import type { Id, User } from '../types/domain.js'
import { forbidden, unauthorized } from '../lib/http.js'
import { verifyToken } from './jwt.js'

export interface AuthContext {
  user: User
  /** Units the user may read. `null` ⇒ all units (admin / unrestricted). */
  allowedUnitIds: Id[] | null
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

/** Units a user may read. Admin (or empty assignment) ⇒ null = all. */
function allowedUnits(user: User): Id[] | null {
  if (user.role === 'admin') return null
  return user.assignedUnitIds.length > 0 ? user.assignedUnitIds : []
}

/** Require a valid bearer token; attaches `req.auth`. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization
  if (!header || !header.startsWith('Bearer ')) throw unauthorized('Missing bearer token')
  const payload = verifyToken(header.slice(7))
  const user = getById(getDb().masters.users, payload.sub)
  if (!user || !user.active) throw unauthorized('User not found or inactive')
  req.auth = { user, allowedUnitIds: allowedUnits(user) }
  next()
}

/** Require `action` on `module` for the authenticated user. */
export function requirePermission(module: Module, action: Action) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const user = req.auth?.user
    if (!user) throw unauthorized()
    if (!can(user, module, action)) throw forbidden(`Not allowed to ${action} ${module}`)
    next()
  }
}

/** True if the user may read/write rows for `unitId`. */
export function canAccessUnit(req: Request, unitId: Id | undefined | null): boolean {
  const allowed = req.auth?.allowedUnitIds
  if (allowed === null || allowed === undefined) return true
  if (!unitId) return true
  return allowed.includes(unitId)
}

/** Throw 403 unless the user may access `unitId`. */
export function assertUnit(req: Request, unitId: Id | undefined | null): void {
  if (!canAccessUnit(req, unitId)) throw forbidden('Outside your assigned units')
}
