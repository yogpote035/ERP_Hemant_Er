/**
 * Roles & Permissions — RBAC role administration.
 *
 * Roles are editable store data (`masters.roles`): the three built-ins seed from
 * ROLE_PRESETS and can be re-tuned or reset, and admins can add custom roles.
 * Every assigned user's effective access flows through the SAME role matrix, so a
 * matrix edit instantly changes what those users can do (the repo wires a
 * roleResolver over masters.roles into can()).
 *
 * Guards ported from frontend src/store/roleCommands.ts:
 *  - the built-in `admin` role is matrix-locked (always full access, not editable),
 *  - built-in roles cannot be renamed or deleted (only reset to preset),
 *  - a custom role cannot be deleted while users still hold it (409 conflict).
 *
 * All routes require the "users" module permission (RBAC module key for role mgmt).
 */
import { Router } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound, conflict } from '../../lib/http.js'
import { authenticate, requirePermission } from '../../auth/middleware.js'
import { resolveId } from '../../lib/id.js'
import type { RootState } from '../../db/state.js'
import {
  ROLE_PRESETS,
  clonePermissions,
  permits,
  ACTIONS,
  MODULES,
  type Action,
  type Module,
  type PermissionSet,
  type Role,
  type RoleDef,
} from '../../types/rbac.js'
import type { Id } from '../../types/domain.js'

// ── helpers ──────────────────────────────────────────────────────────────────
function nameTaken(s: RootState, name: string, exceptId?: Id): boolean {
  const n = name.trim().toLowerCase()
  return values(s.masters.roles).some((r) => r.id !== exceptId && r.name.trim().toLowerCase() === n)
}

function usersWithRole(s: RootState, roleId: Id): number {
  return values(s.masters.users).filter((u) => u.role === roleId).length
}

/** Keep only known module:action pairs (defends the matrix against junk input). */
function sanitize(perms: PermissionSet): PermissionSet {
  const out: PermissionSet = {}
  for (const m of MODULES) {
    const acts = ACTIONS.filter((a) => permits(perms, m, a))
    if (acts.length) out[m] = acts
  }
  return out
}

// ── validation schemas ─────────────────────────────────────────────────────────
const actionEnum = z.enum(ACTIONS as unknown as [Action, ...Action[]])
const moduleEnum = z.enum(MODULES as unknown as [Module, ...Module[]])
const permissionsSchema = z.record(moduleEnum, z.array(actionEnum)) as z.ZodType<PermissionSet>

const createSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional(),
  permissions: permissionsSchema.optional(),
})
const permsSchema = z.object({ permissions: permissionsSchema })
const renameSchema = z.object({
  name: z.string().min(1, 'Role name is required'),
  description: z.string().optional(),
})

export const rolesRouter = Router()
rolesRouter.use(authenticate)

// GET / — list all RoleDefs.
rolesRouter.get(
  '/',
  requirePermission('users', 'view'),
  asyncHandler(async (_req, res) => {
    res.json({ data: values(getDb().masters.roles) })
  })
)

// POST / { name, description, permissions } — create a custom role.
rolesRouter.post(
  '/',
  requirePermission('users', 'create'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body)
    if (nameTaken(getDb(), body.name)) throw conflict(`A role named "${body.name.trim()}" already exists`)
    const role: RoleDef = {
      id: resolveId(body.id, (x) => !!getById(getDb().masters.roles, x), 'role'),
      name: body.name.trim(),
      description: body.description?.trim() || undefined,
      builtIn: false,
      permissions: body.permissions ? sanitize(body.permissions) : {},
    }
    await mutate((s) => putEntity(s.masters.roles, role))
    res.status(201).json({ data: role, cascade: [`Role ${role.name} created`] })
  })
)

// PUT /:id/permissions { permissions } — edit a role's matrix (admin is locked).
rolesRouter.put(
  '/:id/permissions',
  requirePermission('users', 'edit'),
  asyncHandler(async (req, res) => {
    const role = getById(getDb().masters.roles, req.params.id)
    if (!role) throw notFound('Role not found')
    if (role.id === 'admin') throw badRequest('The Admin role always has full access and cannot be edited')
    const { permissions } = permsSchema.parse(req.body)
    const next: RoleDef = { ...role, permissions: sanitize(permissions) }
    await mutate((s) => putEntity(s.masters.roles, next))
    res.json({ data: next, cascade: [`Permissions updated for ${role.name}`] })
  })
)

// PUT /:id { name, description } — rename / re-describe (built-ins are locked).
rolesRouter.put(
  '/:id',
  requirePermission('users', 'edit'),
  asyncHandler(async (req, res) => {
    const role = getById(getDb().masters.roles, req.params.id)
    if (!role) throw notFound('Role not found')
    if (role.builtIn) throw badRequest('Built-in roles cannot be renamed')
    const body = renameSchema.parse(req.body)
    if (nameTaken(getDb(), body.name, role.id)) throw conflict(`A role named "${body.name.trim()}" already exists`)
    const next: RoleDef = { ...role, name: body.name.trim(), description: body.description?.trim() || undefined }
    await mutate((s) => putEntity(s.masters.roles, next))
    res.json({ data: next, cascade: [`Role renamed to ${next.name}`] })
  })
)

// DELETE /:id — delete a custom role (blocked if built-in or still assigned).
rolesRouter.delete(
  '/:id',
  requirePermission('users', 'delete'),
  asyncHandler(async (req, res) => {
    const role = getById(getDb().masters.roles, req.params.id)
    if (!role) throw notFound('Role not found')
    if (role.builtIn) throw badRequest('Built-in roles cannot be deleted')
    const n = usersWithRole(getDb(), role.id)
    if (n > 0) throw conflict(`${n} user(s) still have this role — reassign them first`)
    await mutate((s) => removeEntity(s.masters.roles, role.id))
    res.json({ data: { id: role.id, deleted: true }, cascade: [`Role ${role.name} deleted`] })
  })
)

// POST /:id/reset — reset a built-in role's matrix back to its preset.
rolesRouter.post(
  '/:id/reset',
  requirePermission('users', 'edit'),
  asyncHandler(async (req, res) => {
    const role = getById(getDb().masters.roles, req.params.id)
    if (!role) throw notFound('Role not found')
    if (!role.builtIn) throw badRequest('Only built-in roles can be reset')
    const next: RoleDef = { ...role, permissions: clonePermissions(ROLE_PRESETS[role.id as Role]) }
    await mutate((s) => putEntity(s.masters.roles, next))
    res.json({ data: next, cascade: [`${role.name} reset to defaults`] })
  })
)
