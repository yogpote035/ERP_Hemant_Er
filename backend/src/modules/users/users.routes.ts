/**
 * users module — RBAC user administration (plan P8).
 * Ported from frontend src/store/userCommands.ts: create / update /
 * activate-toggle / permission-override, with the lockout guards (never strip
 * the last active admin, never let an admin deactivate themselves).
 *
 * Passwords arrive as plaintext and are stored ONLY as a bcrypt hash
 * (`passwordHash`). The hash is NEVER returned by any route.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, patchEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound, forbidden } from '../../lib/http.js'
import { authenticate, requirePermission } from '../../auth/middleware.js'
import { config } from '../../config.js'
import { resolveId, nowISO } from '../../lib/id.js'
import { hashPassword } from '../../auth/password.js'
import type { RootState } from '../../db/state.js'
import type { Id, User } from '../../types/domain.js'
import { ACTIONS, BUILTIN_ROLE_IDS, MODULES, type Action, type Module, type Role } from '../../types/rbac.js'
import { buildList, cursorList } from '../../lib/list.js'

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

// ── helpers (ported from userCommands.ts) ────────────────────────────────────
function activeAdmins(s: RootState, exceptId?: Id): User[] {
  return values(s.masters.users).filter((u) => u.role === 'admin' && u.active && u.id !== exceptId)
}
function emailTaken(s: RootState, email: string, exceptId?: Id): boolean {
  const e = email.trim().toLowerCase()
  return values(s.masters.users).some((u) => u.id !== exceptId && u.email.trim().toLowerCase() === e)
}
function roleKnown(s: RootState, role: string): boolean {
  return !!getById(s.masters.roles, role) || BUILTIN_ROLE_IDS.includes(role as Role)
}
/** Common create/update validation; throws badRequest on the first problem. */
function commonChecks(
  s: RootState,
  input: { name: string; email: string; role: string; assignedUnitIds: Id[] },
  exceptId: Id | undefined
): void {
  if (!input.name.trim()) throw badRequest('Name is required')
  if (!EMAIL_RE.test(input.email.trim())) throw badRequest('A valid email is required')
  if (emailTaken(s, input.email, exceptId)) throw badRequest(`Email ${input.email.trim()} is already in use`)
  if (!roleKnown(s, input.role)) throw badRequest('Invalid role')
  if (input.role !== 'admin' && input.assignedUnitIds.length === 0) {
    throw badRequest('Assign at least one unit for a non-admin user')
  }
  for (const u of input.assignedUnitIds) {
    if (!getById(s.masters.units, u)) throw badRequest('Assignment references an unknown unit')
  }
}

/** Strip the bcrypt hash before any user leaves the API. */
function publicUser(u: User): Omit<User, 'passwordHash'> {
  const { passwordHash: _omit, ...rest } = u
  return rest
}

// ── schemas ─────────────────────────────────────────────────────────────────
const moduleEnum = z.enum(MODULES as unknown as [Module, ...Module[]])
const actionEnum = z.enum(ACTIONS as unknown as [Action, ...Action[]])
const permissionSetSchema = z.record(moduleEnum, z.array(actionEnum))
const permissionOverrideSchema = z
  .object({ add: permissionSetSchema.optional(), remove: permissionSetSchema.optional() })
  .strict()

const createSchema = z.object({
  id: z.string().optional(),
  name: z.string(),
  email: z.string(),
  password: z.string().min(1).optional(),
  role: z.string(),
  assignedUnitIds: z.array(z.string()).default([]),
  active: z.boolean().optional(),
})

const updateSchema = z.object({
  name: z.string(),
  email: z.string(),
  role: z.string(),
  assignedUnitIds: z.array(z.string()).default([]),
  password: z.string().min(1).optional(),
})

// ── router ───────────────────────────────────────────────────────────────────
export const usersRouter = Router()
usersRouter.use(authenticate)

// GET / — list users WITHOUT passwordHash.
usersRouter.get(
  '/',
  requirePermission('users', 'view'),
  asyncHandler(async (req, res) => {
    const rows = values(getDb().masters.users).map(publicUser)
    const searchText = (r: (typeof rows)[number]) => `${r.name} ${r.email} ${r.role}`
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

// POST / — create a user; plaintext password is hashed into passwordHash.
usersRouter.post(
  '/',
  requirePermission('users', 'create'),
  asyncHandler(async (req: Request, res) => {
    const input = createSchema.parse(req.body)
    const s = getDb()
    commonChecks(s, input, undefined)

    const id = resolveId(input.id, (x) => !!getById(s.masters.users, x), 'usr')
    // Demo convenience: dev seeds new users with the well-known `demo` password.
    // In production that's a credential weakness — require a real, ≥8-char password.
    const provided = input.password?.trim()
    if (config.isProd && (!provided || provided.length < 8)) {
      throw badRequest('A password of at least 8 characters is required')
    }
    const plain = provided || 'demo'
    const user: User = {
      id,
      name: input.name.trim(),
      email: input.email.trim(),
      passwordHash: hashPassword(plain),
      role: input.role,
      assignedUnitIds: input.role === 'admin' ? [] : [...input.assignedUnitIds],
      active: input.active ?? true,
      createdAt: nowISO(),
      createdBy: req.auth!.user.id,
    }
    await mutate((st) => putEntity(st.masters.users, user))
    res.status(201).json({
      data: publicUser(user),
      cascade: [`User ${user.name} created`, `role ${user.role}`],
    })
  })
)

// PUT /:id — update name/email/role/assignedUnitIds; optional password rehash.
usersRouter.put(
  '/:id',
  requirePermission('users', 'edit'),
  asyncHandler(async (req: Request, res) => {
    const input = updateSchema.parse(req.body)
    const s = getDb()
    const existing = getById(s.masters.users, req.params.id)
    if (!existing) throw notFound('User not found')
    commonChecks(s, input, existing.id)
    // Lockout guard: demoting the last active admin out of 'admin' is blocked.
    if (existing.role === 'admin' && input.role !== 'admin' && activeAdmins(s, existing.id).length === 0) {
      throw badRequest('At least one active admin must remain')
    }

    const patch: Partial<User> = {
      name: input.name.trim(),
      email: input.email.trim(),
      role: input.role,
      assignedUnitIds: input.role === 'admin' ? [] : [...input.assignedUnitIds],
    }
    if (input.password?.trim()) patch.passwordHash = hashPassword(input.password.trim())

    await mutate((st) => patchEntity(st.masters.users, existing.id, patch))
    const next = getById(getDb().masters.users, existing.id) as User
    res.json({
      data: publicUser(next),
      cascade: [`User ${next.name} updated`, `role ${next.role}`],
    })
  })
)

// PATCH /:id/active { active } — guards self + last-admin lockout on deactivate.
usersRouter.patch(
  '/:id/active',
  requirePermission('users', 'edit'),
  asyncHandler(async (req: Request, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body)
    const s = getDb()
    const u = getById(s.masters.users, req.params.id)
    if (!u) throw notFound('User not found')
    if (!active && u.active) {
      // Deactivating an active user — guard self + last-admin lockout.
      if (req.auth!.user.id === u.id) throw forbidden('You cannot deactivate your own account')
      if (u.role === 'admin' && activeAdmins(s, u.id).length === 0) {
        throw badRequest('At least one active admin must remain')
      }
    }
    await mutate((st) => patchEntity(st.masters.users, u.id, { active }))
    res.json({
      data: publicUser({ ...u, active }),
      cascade: [`${u.name} ${active ? 'activated' : 'deactivated'}`],
    })
  })
)

// PUT /:id/override { add, remove } — custom permission deltas (non-admins only).
usersRouter.put(
  '/:id/override',
  requirePermission('users', 'edit'),
  asyncHandler(async (req: Request, res) => {
    const overrides = permissionOverrideSchema.parse(req.body ?? {})
    const s = getDb()
    const u = getById(s.masters.users, req.params.id)
    if (!u) throw notFound('User not found')
    if (u.role === 'admin') throw badRequest('Admins already have every permission')

    const empty =
      (!overrides.add || Object.keys(overrides.add).length === 0) &&
      (!overrides.remove || Object.keys(overrides.remove).length === 0)
    await mutate((st) =>
      patchEntity(st.masters.users, u.id, { overrides: empty ? undefined : overrides })
    )
    const next = getById(getDb().masters.users, u.id) as User
    res.json({
      data: publicUser(next),
      cascade: [empty ? `${u.name}: reset to ${u.role} defaults` : `${u.name}: custom permissions saved`],
    })
  })
)
