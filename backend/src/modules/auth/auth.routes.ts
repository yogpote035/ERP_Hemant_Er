import { Router } from 'express'
import { z } from 'zod'
import { getDb, values, mutate } from '../../db/repository.js'
import { patchEntity } from '../../db/normalized.js'
import { asyncHandler, unauthorized } from '../../lib/http.js'
import { verifyPassword, hashPassword } from '../../auth/password.js'
import { signToken } from '../../auth/jwt.js'
import { authenticate } from '../../auth/middleware.js'
import { effectivePermissions } from '../../types/rbac.js'
import type { User } from '../../types/domain.js'

/** Public user shape — never leaks the password hash. */
export function publicUser(u: User) {
  const { passwordHash: _omit, ...rest } = u
  void _omit
  return { ...rest, permissions: effectivePermissions(u.role, u.overrides) }
}

const loginSchema = z.object({
  email: z.string().trim().email('A valid email address is required'),
  password: z.string().min(1),
})

export const authRouter = Router()

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { email, password } = loginSchema.parse(req.body)
    const user = values(getDb().masters.users).find(
      (u) => u.email.toLowerCase() === email.toLowerCase()
    )
    if (!user || !user.active || !verifyPassword(password, user.passwordHash)) {
      throw unauthorized('Invalid credentials')
    }
    const token = signToken({ sub: user.id, email: user.email })
    res.json({ token, user: publicUser(user) })
  })
)

authRouter.get(
  '/me',
  authenticate,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.auth!.user) })
  })
)

const changePwSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8, 'New password must be at least 8 characters'),
})

authRouter.post(
  '/change-password',
  authenticate,
  asyncHandler(async (req, res) => {
    const { currentPassword, newPassword } = changePwSchema.parse(req.body)
    const user = req.auth!.user
    if (!verifyPassword(currentPassword, user.passwordHash)) throw unauthorized('Current password is incorrect')
    const passwordHash = hashPassword(newPassword)
    await mutate((s) => patchEntity(s.masters.users, user.id, { passwordHash }))
    res.json({ data: { ok: true } })
  })
)
