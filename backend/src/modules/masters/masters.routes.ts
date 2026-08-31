/**
 * Generic master CRUD — one config-driven router covering the 8 plain master
 * collections (units, customers, vendors, parts, stock-openings, machines,
 * operations, employees). Users, roles and rates have their own modules.
 *
 * Contract: money fields are integer paise. Server manages `id` and `active`.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById, queryCollectionPage } from '../../db/repository.js'
import { putEntity, removeEntity, patchEntity } from '../../db/normalized.js'
import type { Normalized, RmRate } from '../../types/domain.js'
import { asyncHandler, badRequest, notFound } from '../../lib/http.js'
import { genericSearchText } from '../../lib/list.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { genId, resolveId, todayISO } from '../../lib/id.js'
import type { Paise } from '../../lib/money.js'
import type { RootState } from '../../db/state.js'
import type { Module } from '../../types/rbac.js'

interface Entity {
  id: string
  active?: boolean
  unitId?: string
}

/** Keep Part.RM Rate and Rate Masters as two entry points to one value. */
function syncPartRmRate(s: RootState, part: Entity, previousRate: unknown): void {
  const ratePaise = (part as unknown as Record<string, unknown>).rmRatePaise
  if (typeof ratePaise !== 'number' || ratePaise === previousRate) return
  const effectiveFrom = todayISO()
  for (const rate of values(s.masters.rmRates)) {
    if (rate.partId === part.id && !rate.supersededAt && rate.effectiveFrom <= effectiveFrom) {
      patchEntity(s.masters.rmRates, rate.id, { supersededAt: effectiveFrom })
    }
  }
  const rate: RmRate = {
    id: genId('rm'), partId: part.id, ratePaise: ratePaise as Paise, effectiveFrom,
  }
  putEntity(s.masters.rmRates, rate)
}

interface MasterCfg {
  idPrefix: string
  module: Module
  unitScoped: boolean
  softDelete: boolean
  collection: (s: RootState) => Normalized<Entity>
  schema: z.ZodType<Record<string, unknown>>
}

const addressLines = z.array(z.string()).default([])

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/
const gstin = z.string().trim().transform((value) => value.toUpperCase()).pipe(
  z.string().regex(GSTIN_RE, 'Invalid GSTIN (e.g. 27ABCDE1234F1Z5)'),
)
const optionalGstin = z.preprocess(
  (value) => typeof value === 'string' && value.trim() === '' ? undefined : value,
  gstin.optional(),
)

function validateGstinState(
  value: { gstin?: string, stateCode?: string },
  ctx: z.RefinementCtx,
): void {
  if (value.gstin && value.stateCode && value.gstin.slice(0, 2) !== value.stateCode) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['stateCode'],
      message: 'Must match first 2 GSTIN digits',
    })
  }
}

const invoiceFormat = z.string()
  .trim()
  .min(1, 'Invoice format is required')
  .refine((value) => value.includes('{seq}'), 'Invoice format must include {seq}')
  .refine((value) => value.includes('{FY}'), 'Invoice format must include {FY}')
  .refine(
    (value) => !/[{}]/.test(value.replace(/\{seq\}/g, '').replace(/\{FY\}/g, '')),
    'Only {seq} and {FY} placeholders are supported',
  )
  .refine(
    (value) => /^[A-Za-z0-9/-]+$/.test(value.replace(/\{seq\}/g, '1').replace(/\{FY\}/g, '24-25')),
    'Invoice format may contain only letters, numbers, / and -',
  )

const REGISTRY: Record<string, MasterCfg> = {
  units: {
    idPrefix: 'unit', module: 'masters', unitScoped: false, softDelete: true,
    collection: (s) => s.masters.units as unknown as Normalized<Entity>,
    schema: z.object({
      name: z.string().min(1), code: z.string().min(1), gstin,
      stateCode: z.string().regex(/^\d{2}$/), addressLines, invoiceFormat: invoiceFormat.default('{seq}/{FY}'),
      seqPad: z.number().int().min(0).default(0),
      bankName: z.string().optional(), bankBranch: z.string().optional(), accountNo: z.string().optional(), ifsc: z.string().optional(),
      logoDataUrl: z.string().optional(),
    }).superRefine(validateGstinState),
  },
  customers: {
    idPrefix: 'cust', module: 'masters', unitScoped: false, softDelete: true,
    collection: (s) => s.masters.customers as unknown as Normalized<Entity>,
    schema: z.object({
      name: z.string().min(1), gstin, stateCode: z.string().regex(/^\d{2}$/),
      addressLines, paymentTermsDays: z.number().int().min(0).optional(),
      shippingName: z.string().optional(), shippingAddressLines: addressLines,
      shippingGstin: optionalGstin, shippingStateCode: z.string().regex(/^\d{2}$/).optional(),
      contactPerson: z.string().optional(),
      phone: z.string().regex(/^[+()\d\s-]{7,20}$/).optional(),
      email: z.string().email().optional(),
      freightTerms: z.string().optional(), transitInsuranceTerms: z.string().optional(),
      sez: z.boolean().optional(),
    }).superRefine((v, ctx) => {
      validateGstinState(v, ctx)
      if (v.shippingGstin && !v.shippingStateCode) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shippingStateCode'], message: 'Required with consignee GSTIN' })
      if (v.shippingGstin && v.shippingStateCode && v.shippingGstin.slice(0, 2) !== v.shippingStateCode) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['shippingStateCode'], message: 'Must match first 2 consignee GSTIN digits' })
      }
    }),
  },
  vendors: {
    idPrefix: 'vnd', module: 'masters', unitScoped: true, softDelete: true,
    collection: (s) => s.masters.vendors as unknown as Normalized<Entity>,
    schema: z.object({
      unitId: z.string().min(1),
      name: z.string().min(1), code: z.string().min(1), type: z.enum(['rm', 'service']),
      contactPerson: z.string().optional(), phone: z.string().optional(), email: z.string().optional(),
      gstin: optionalGstin, pan: z.string().optional(), stateCode: z.string().regex(/^\d{2}$/).optional(),
      addressLines, city: z.string().optional(), pincode: z.string().optional(),
      bankName: z.string().optional(), accountNo: z.string().optional(), ifsc: z.string().optional(),
      invoiceFormat: z.string().optional(), remarks: z.string().optional(),
    }).superRefine(validateGstinState),
  },
  parts: {
    idPrefix: 'part', module: 'masters', unitScoped: true, softDelete: true,
    collection: (s) => s.masters.parts as unknown as Normalized<Entity>,
    schema: z.object({
      partNo: z.string().min(1), materialCode: z.string().min(1), description: z.string().optional(),
      defaultPoNo: z.string().optional(), defaultPoDate: z.string().optional(),
      category: z.string().optional(), editionNo: z.string().optional(), unitId: z.string().min(1),
      uom: z.string().default('NOS'), hsnSac: z.string().default('84829900'),
      gstPct: z.number().min(0).max(28).default(12),
      finishWtMg: z.number().int().min(0).default(0), scrapWtMg: z.number().int().min(0).default(0),
      rmRatePaise: z.number().int().min(0).optional(), rmWtMg: z.number().int().min(0).optional(),
      avgQtyPerBox: z.number().int().min(1).default(50), packingMode: z.string().optional(),
    }),
  },
  'stock-openings': {
    idPrefix: 'so', module: 'masters', unitScoped: true, softDelete: false,
    collection: (s) => s.masters.stockOpenings as unknown as Normalized<Entity>,
    schema: z.object({
      unitId: z.string().min(1), partId: z.string().min(1), fy: z.string().min(1),
      openingQty: z.number().int(), asOfDate: z.string().min(1),
    }),
  },
  machines: {
    idPrefix: 'mc', module: 'masters', unitScoped: true, softDelete: true,
    collection: (s) => s.masters.machines as unknown as Normalized<Entity>,
    schema: z.object({
      machineNo: z.string().min(1), description: z.string().optional(), unitId: z.string().min(1),
    }),
  },
  operations: {
    idPrefix: 'op', module: 'masters', unitScoped: false, softDelete: true,
    collection: (s) => s.masters.operations as unknown as Normalized<Entity>,
    schema: z.object({ code: z.string().min(1), description: z.string().optional() }),
  },
  employees: {
    idPrefix: 'emp', module: 'masters', unitScoped: true, softDelete: true,
    collection: (s) => s.masters.employees as unknown as Normalized<Entity>,
    schema: z.object({
      name: z.string().min(1), empCode: z.string().min(1), phone: z.string().optional(),
      labourType: z.enum(['production', 'shift', 'both']).default('production'),
      standardShiftRatePaise: z.number().int().min(0).default(0), unitId: z.string().min(1),
    }),
  },
}

function cfgOf(entity: string): MasterCfg {
  const cfg = REGISTRY[entity]
  if (!cfg) throw notFound(`Unknown master '${entity}'`)
  return cfg
}

/** entity url-segment → its `documents` collection path (for DB-level paging). */
const PATH_OF: Record<string, string> = {
  units: 'masters.units',
  customers: 'masters.customers',
  vendors: 'masters.vendors',
  parts: 'masters.parts',
  'stock-openings': 'masters.stockOpenings',
  machines: 'masters.machines',
  operations: 'masters.operations',
  employees: 'masters.employees',
}

/** Filter a list down to the units the caller may read. */
function scopeList(req: Request, cfg: MasterCfg, rows: Entity[]): Entity[] {
  if (!cfg.unitScoped) return rows
  const allowed = req.auth?.allowedUnitIds
  if (allowed == null) return rows
  return rows.filter((r) => r.unitId != null && allowed.includes(r.unitId))
}

const listQuery = z.object({
  page: z.coerce.number().int().positive().optional(),
  pageSize: z.coerce.number().int().positive().max(1000).optional(),
  limit: z.coerce.number().int().positive().max(1000).optional(),
  cursor: z.string().optional(),
  mode: z.enum(['offset', 'cursor']).optional(),
  search: z.string().trim().optional(),
})

export const mastersRouter = Router()
mastersRouter.use(authenticate)

mastersRouter.get(
  '/:entity',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    if (!req.auth || !canView(req, cfg)) throw notFound()
    const q = listQuery.parse(req.query)
    const unitIds = cfg.unitScoped && req.auth.allowedUnitIds ? req.auth.allowedUnitIds : undefined

    // No paging params ⇒ return all (the hydrate path needs the whole collection),
    // still honouring `search`.
    const paginated = q.page != null || q.pageSize != null || q.limit != null || q.cursor != null || q.mode != null
    if (!paginated) {
      let rows = scopeList(req, cfg, values(cfg.collection(getDb())))
      if (q.search) {
        const needle = q.search.toLowerCase()
        rows = rows.filter((r) => genericSearchText(r as unknown as Record<string, unknown>).toLowerCase().includes(needle))
      }
      res.json({ data: rows, total: rows.length })
      return
    }

    // Otherwise fetch exactly ONE page straight from the datastore (real SQL LIMIT/OFFSET
    // or keyset cursor on Postgres) — the whole collection is never loaded.
    const path = PATH_OF[req.params.entity]
    if (q.mode === 'cursor' || q.cursor != null) {
      const r = await queryCollectionPage(path, { mode: 'cursor', limit: q.limit ?? q.pageSize ?? 25, cursor: q.cursor, search: q.search, unitIds })
      res.json({ data: r.rows, total: r.total, nextCursor: r.nextCursor, hasMore: r.nextCursor != null })
    } else {
      const pageSize = q.pageSize ?? q.limit ?? 25
      const page = q.page ?? 1
      const r = await queryCollectionPage(path, { mode: 'offset', limit: pageSize, offset: (page - 1) * pageSize, search: q.search, unitIds })
      res.json({ data: r.rows, total: r.total, page, pageSize, totalPages: Math.max(1, Math.ceil(r.total / pageSize)) })
    }
  })
)

mastersRouter.get(
  '/:entity/:id',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    if (!req.auth || !canView(req, cfg)) throw notFound() // same gate as the list route
    const row = getById(cfg.collection(getDb()), req.params.id)
    if (!row) throw notFound()
    if (cfg.unitScoped) assertUnit(req, row.unitId)
    res.json({ data: row })
  })
)

mastersRouter.post(
  '/:entity',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    requireAction(req, cfg, 'create')
    const body = cfg.schema.parse(req.body)
    if (cfg.unitScoped) assertUnit(req, body.unitId as string)
    const providedId = typeof (req.body as { id?: unknown })?.id === 'string' ? (req.body as { id?: string }).id : undefined
    const entity: Entity = { ...body, id: resolveId(providedId, (id) => !!getById(cfg.collection(getDb()), id), cfg.idPrefix), ...(cfg.softDelete ? { active: true } : {}) }
    await mutate((s) => {
      putEntity(cfg.collection(s), entity)
      if (req.params.entity === 'parts') syncPartRmRate(s, entity, undefined)
    })
    res.status(201).json({ data: entity })
  })
)

mastersRouter.put(
  '/:entity/:id',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    requireAction(req, cfg, 'edit')
    const cur = getById(cfg.collection(getDb()), req.params.id)
    if (!cur) throw notFound()
    if (cfg.unitScoped) assertUnit(req, cur.unitId)
    const body = cfg.schema.parse(req.body)
    if (cfg.unitScoped) assertUnit(req, body.unitId as string)
    // Only overwrite fields the caller actually sent; keep stored values for omitted
    // ones (the create schema fills defaults for optionals, which would clobber them).
    const sent = (req.body ?? {}) as Record<string, unknown>
    const merged = { ...cur } as Record<string, unknown>
    for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
      if (k in sent) merged[k] = v
    }
    const next = { ...merged, id: cur.id } as Entity
    await mutate((s) => {
      putEntity(cfg.collection(s), next)
      if (req.params.entity === 'parts') {
        syncPartRmRate(s, next, (cur as unknown as Record<string, unknown>).rmRatePaise)
      }
    })
    res.json({ data: next })
  })
)

mastersRouter.delete(
  '/:entity/:id',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    requireAction(req, cfg, 'delete')
    const cur = getById(cfg.collection(getDb()), req.params.id)
    if (!cur) throw notFound()
    if (cfg.unitScoped) assertUnit(req, cur.unitId)
    if (cfg.softDelete) {
      await mutate((s) => patchEntity(cfg.collection(s), cur.id, { active: false }))
      res.json({ data: { id: cur.id, active: false } })
    } else {
      await mutate((s) => removeEntity(cfg.collection(s), cur.id))
      res.json({ data: { id: cur.id, deleted: true } })
    }
  })
)

// PATCH /:entity/:id/active { active } — reactivate a soft-deleted row.
mastersRouter.patch(
  '/:entity/:id/active',
  asyncHandler(async (req, res) => {
    const cfg = cfgOf(req.params.entity)
    requireAction(req, cfg, 'edit')
    if (!cfg.softDelete) throw badRequest('This master does not support activation')
    const cur = getById(cfg.collection(getDb()), req.params.id)
    if (!cur) throw notFound()
    if (cfg.unitScoped) assertUnit(req, cur.unitId)
    const active = z.object({ active: z.boolean() }).parse(req.body).active
    await mutate((s) => patchEntity(cfg.collection(s), cur.id, { active }))
    res.json({ data: { id: cur.id, active } })
  })
)

// ── permission helpers ─────────────────────────────────────────────────────────
import { can } from '../../types/rbac.js'
function canView(req: Request, cfg: MasterCfg): boolean {
  return can(req.auth?.user ?? null, cfg.module, 'view')
}
function requireAction(req: Request, cfg: MasterCfg, action: 'create' | 'edit' | 'delete'): void {
  requirePermission(cfg.module, action)(req, undefined as never, () => {})
}
