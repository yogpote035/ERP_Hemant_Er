/**
 * Inward register module (plan §7 P2) — create + read inward challans.
 *
 * Ported from the frontend:
 *   - store/registerCommands.ts  (runSaveInward → validateInward / applyInward)
 *   - selectors/register.ts      (selectInwardRows, via domain/register.js)
 *   - selectors/stock.ts         (derived balance / available, via domain/stock.js)
 *
 * Session/scope usage (writableUnitIds / scopedInwards) is replaced by the
 * route-layer auth scope: `req.auth.allowedUnitIds` for reads, `assertUnit`
 * for the write. Money fields are integer paise.
 */
import { Router } from 'express'
import { z } from 'zod'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, patchEntity, removeEntity } from '../../db/normalized.js'
import { config } from '../../config.js'
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { resolveId, nowISO } from '../../lib/id.js'
import type { Id, Inward } from '../../types/domain.js'
import type { Paise } from '../../lib/money.js'
import { selectInwardRows } from '../../domain/register.js'
import { dispatchTotalQty } from '../../domain/stock.js'
import { buildList, cursorList } from '../../lib/list.js'

/** Pieces already dispatched (any kind) against an inward challan. */
function consumedForInward(s: ReturnType<typeof getDb>, inwardId: Id): number {
  return values(s.inventory.dispatches)
    .filter((d) => d.inwardId === inwardId)
    .reduce((a, d) => a + dispatchTotalQty(d), 0)
}

// ── body schema (create) — ports validateInward's field rules ────────────────────
const createSchema = z.object({
  id: z.string().optional(),
  unitId: z.string().min(1, 'Unit is required'),
  partId: z.string().min(1, 'Part is required'),
  vendorId: z.string().optional(),
  customerId: z.string().optional(),
  challanNo: z.string().trim().optional().default(''),
  challanDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').optional().or(z.literal('')).default(''),
  poNo: z.string().optional(),
  dieNo: z.string().optional(),
  batchHeatNo: z.string().trim().optional().default(''),
  binNo: z.string().optional(),
  rmRatePaise: z.number().int().nonnegative().optional(),
  rmWtMg: z.number().int().nonnegative().optional(),
  finishWtMg: z.number().int().nonnegative().optional(),
  receivedQty: z.number().int().positive('Received qty must be greater than 0'),
  attachmentName: z.string().optional(),
  remarks: z.string().optional(),
})

/** The unit scope this request may read (null = all units). */
function allowedSet(allowed: Id[] | null): Set<Id> | null {
  return allowed ? new Set(allowed) : null
}

export const inwardRouter = Router()
inwardRouter.use(authenticate)

/**
 * GET / — list inward rows (each with derived part/vendor names, dispatched /
 * available qty, open-balance status, and child dispatches). Unit-scoped to the
 * caller's allowed units. Optional `?from=&to=` filters on `challanDate`
 * (inclusive); an empty window passes everything.
 */
inwardRouter.get(
  '/',
  requirePermission('inward', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to, partNo, balance } = z
      .object({
        from: z.string().optional(),
        to: z.string().optional(),
        partNo: z.string().optional(),
        balance: z.enum(['open', 'done']).optional(),
      })
      .parse(req.query)

    const allowed = allowedSet(req.auth!.allowedUnitIds)
    let rows = selectInwardRows(getDb(), allowed)
    if (from || to) {
      rows = rows.filter((r) => {
        const d = r.inward.challanDate
        if (from && d < from) return false
        if (to && d > to) return false
        return true
      })
    }
    if (partNo) rows = rows.filter((r) => r.partNo === partNo)
    if (balance === 'open') rows = rows.filter((r) => r.balance !== 'Dispatched')
    if (balance === 'done') rows = rows.filter((r) => r.balance === 'Dispatched')
    const searchText = (r: (typeof rows)[number]) =>
      `${r.inward.challanNo} ${r.inward.batchHeatNo} ${r.inward.poNo ?? ''} ${r.partNo} ${r.vendorName ?? ''}`
    // `?mode=cursor` ⇒ keyset pagination ({ data, nextCursor, hasMore, total });
    // otherwise offset/all via buildList.
    if (req.query.mode === 'cursor') {
      res.json(cursorList(rows, req.query, { idOf: (r) => r.inward.id, searchText }))
    } else {
      res.json(buildList(rows, req.query, searchText))
    }
  })
)

/** GET /:id — one inward row (derived shape), 404 if outside scope or missing. */
inwardRouter.get(
  '/:id',
  requirePermission('inward', 'view'),
  asyncHandler(async (req, res) => {
    const inward = getById(getDb().inventory.inwards, req.params.id)
    if (!inward) throw notFound('Inward challan not found')
    assertUnit(req, inward.unitId)
    const allowed = allowedSet(req.auth!.allowedUnitIds)
    const row = selectInwardRows(getDb(), allowed).find((r) => r.inward.id === req.params.id)
    if (!row) throw notFound('Inward challan not found')
    res.json({ data: row })
  })
)

/**
 * POST / — create an inward challan. Ports validateInward (field rules via the
 * schema; the duplicate-challan guard below) + applyInward (server-managed
 * id/createdBy/createdAt). Write scope is enforced with assertUnit.
 */
inwardRouter.post(
  '/',
  requirePermission('inward', 'create'),
  asyncHandler(async (req, res) => {
    const body = createSchema.parse(req.body)
    assertUnit(req, body.unitId)

    // Referential checks the frontend gets for free via the masters store.
    const db = getDb()
    if (!getById(db.masters.units, body.unitId)) throw badRequest('Unknown unit')
    const part = getById(db.masters.parts, body.partId)
    if (!part) throw badRequest('Unknown part')
    if (part.unitId !== body.unitId) throw badRequest('Catalogue part does not belong to the selected unit')
    const vendor = body.vendorId ? getById(db.masters.vendors, body.vendorId) : undefined
    if (body.vendorId && (!vendor || !vendor.active)) throw badRequest('Unknown or inactive vendor')
    if (vendor?.unitId && vendor.unitId !== body.unitId) throw badRequest('RM supplier does not belong to the selected unit')
    if (body.customerId && !getById(db.masters.customers, body.customerId)) throw badRequest('Unknown customer')

    // Duplicate-challan guard: one (unit, challan, part) row only.
    const dup = values(db.inventory.inwards).some(
      (i) => Boolean(body.challanNo) && i.unitId === body.unitId && i.partId === body.partId && i.challanNo === body.challanNo
    )
    if (dup) throw conflict(`Challan ${body.challanNo} already exists for this part`)

    const inward: Inward = {
      id: resolveId(body.id, (id) => !!getById(db.inventory.inwards, id), 'inw'),
      unitId: body.unitId,
      partId: body.partId,
      vendorId: body.vendorId,
      customerId: body.customerId,
      challanNo: body.challanNo,
      challanDate: body.challanDate,
      poNo: body.poNo,
      dieNo: body.dieNo,
      batchHeatNo: body.batchHeatNo,
      binNo: body.binNo,
      rmRatePaise: body.rmRatePaise as Paise | undefined,
      rmWtMg: body.rmWtMg,
      finishWtMg: body.finishWtMg,
      receivedQty: body.receivedQty,
      attachmentName: body.attachmentName,
      remarks: body.remarks,
      createdBy: req.auth!.user.id,
      createdAt: nowISO(),
    }
    await mutate((s) => putEntity(s.inventory.inwards, inward))

    res.status(201).json({
      data: inward,
      cascade: [`Inward ${inward.challanNo} · ${inward.receivedQty} pcs`],
    })
  })
)

/**
 * PUT /:id — edit an inward challan. Same field rules as create, plus: the new
 * receivedQty may not drop below what's already been dispatched, and the
 * duplicate-challan guard excludes the row being edited. id/createdBy/createdAt
 * are preserved.
 */
inwardRouter.put(
  '/:id',
  requirePermission('inward', 'edit'),
  asyncHandler(async (req, res) => {
    const cur = getById(getDb().inventory.inwards, req.params.id)
    if (!cur) throw notFound('Inward challan not found')
    assertUnit(req, cur.unitId)
    const body = createSchema.parse(req.body)
    assertUnit(req, body.unitId)

    const db = getDb()
    if (!getById(db.masters.units, body.unitId)) throw badRequest('Unknown unit')
    const part = getById(db.masters.parts, body.partId)
    if (!part) throw badRequest('Unknown part')
    if (part.unitId !== body.unitId) throw badRequest('Catalogue part does not belong to the selected unit')
    const vendor = body.vendorId ? getById(db.masters.vendors, body.vendorId) : undefined
    if (body.vendorId && (!vendor || !vendor.active)) throw badRequest('Unknown or inactive vendor')
    if (vendor?.unitId && vendor.unitId !== body.unitId) throw badRequest('RM supplier does not belong to the selected unit')
    if (body.customerId && !getById(db.masters.customers, body.customerId)) throw badRequest('Unknown customer')

    const dup = values(db.inventory.inwards).some(
      (i) => Boolean(body.challanNo) && i.id !== cur.id && i.unitId === body.unitId && i.partId === body.partId && i.challanNo === body.challanNo
    )
    if (dup) throw conflict(`Challan ${body.challanNo} already exists for this part`)

    const consumed = consumedForInward(db, cur.id)
    if (body.receivedQty < consumed) {
      throw badRequest(`Received qty (${body.receivedQty}) is below the ${consumed} already dispatched on this challan`)
    }

    const next: Inward = {
      ...cur,
      unitId: body.unitId,
      partId: body.partId,
      vendorId: body.vendorId,
      customerId: body.customerId,
      challanNo: body.challanNo,
      challanDate: body.challanDate,
      poNo: body.poNo,
      dieNo: body.dieNo,
      batchHeatNo: body.batchHeatNo,
      binNo: body.binNo,
      rmRatePaise: body.rmRatePaise as Paise | undefined,
      rmWtMg: body.rmWtMg,
      finishWtMg: body.finishWtMg,
      receivedQty: body.receivedQty,
      attachmentName: body.attachmentName,
      remarks: body.remarks,
    }
    await mutate((s) => putEntity(s.inventory.inwards, next))
    res.json({ data: next, cascade: [`Inward ${next.challanNo} updated`] })
  })
)

/**
 * DELETE /:id — remove an inward challan. Blocked while it still has dispatches
 * (remove those first) or rejection advices referencing it (dangling-link guard).
 */
inwardRouter.delete(
  '/:id',
  requirePermission('inward', 'delete'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const cur = getById(db.inventory.inwards, req.params.id)
    if (!cur) throw notFound('Inward challan not found')
    assertUnit(req, cur.unitId)
    if (consumedForInward(db, cur.id) > 0) throw conflict('Remove its dispatches before deleting this challan')
    const rejRefs = values(db.rejection.rejectionAdvices).filter((r) => r.sourceInwardId === cur.id).length
    if (rejRefs > 0) throw conflict('Remove its rejection advices before deleting this challan')
    await mutate((s) => removeEntity(s.inventory.inwards, cur.id))
    res.json({ data: { id: cur.id, deleted: true }, cascade: [`Inward ${cur.challanNo} deleted`] })
  })
)

// ── Attachment (FR-IN09) — scanned challan/invoice document ──────────────────────
// Bytes live on disk at data/uploads/<inwardId> (the id is server-minted, so the
// path can't be traversal-attacked); the entity carries only name + mime.
const uploadsDir = join(dirname(config.dataFile), 'uploads')
const attachPath = (inwardId: string) => join(uploadsDir, inwardId)
const MAX_ATTACH_BYTES = 10 * 1024 * 1024
const uploadSchema = z.object({
  filename: z.string().min(1).max(200),
  mime: z.string().min(1).max(120),
  dataBase64: z.string().min(1),
})

inwardRouter.post(
  '/:id/attachment',
  requirePermission('inward', 'edit'),
  asyncHandler(async (req, res) => {
    const body = uploadSchema.parse(req.body)
    const cur = getById(getDb().inventory.inwards, req.params.id)
    if (!cur) throw notFound('Inward challan not found')
    assertUnit(req, cur.unitId)
    const buf = Buffer.from(body.dataBase64, 'base64')
    if (buf.length === 0) throw badRequest('Empty file')
    if (buf.length > MAX_ATTACH_BYTES) throw badRequest('File too large (max 10 MB)')
    mkdirSync(uploadsDir, { recursive: true })
    writeFileSync(attachPath(cur.id), buf)
    const updated = await mutate((s) => {
      patchEntity(s.inventory.inwards, cur.id, { attachmentName: body.filename, attachmentMime: body.mime })
      return getById(s.inventory.inwards, cur.id) as Inward
    })
    res.json({ data: updated, cascade: [`Attached ${body.filename} to ${cur.challanNo}`] })
  })
)

inwardRouter.get(
  '/:id/attachment',
  requirePermission('inward', 'view'),
  asyncHandler(async (req, res) => {
    const cur = getById(getDb().inventory.inwards, req.params.id)
    if (!cur) throw notFound('Inward challan not found')
    assertUnit(req, cur.unitId)
    const path = attachPath(cur.id)
    if (!cur.attachmentName || !existsSync(path)) throw notFound('No attachment on this challan')
    res.setHeader('Content-Type', cur.attachmentMime || 'application/octet-stream')
    res.setHeader('Content-Disposition', `inline; filename="${cur.attachmentName.replace(/[^\w.\- ]/g, '_')}"`)
    res.send(readFileSync(path))
  })
)

inwardRouter.delete(
  '/:id/attachment',
  requirePermission('inward', 'edit'),
  asyncHandler(async (req, res) => {
    const cur = getById(getDb().inventory.inwards, req.params.id)
    if (!cur) throw notFound('Inward challan not found')
    assertUnit(req, cur.unitId)
    if (existsSync(attachPath(cur.id))) rmSync(attachPath(cur.id))
    const updated = await mutate((s) => {
      patchEntity(s.inventory.inwards, cur.id, { attachmentName: undefined, attachmentMime: undefined })
      return getById(s.inventory.inwards, cur.id) as Inward
    })
    res.json({ data: updated, cascade: [`Removed attachment from ${cur.challanNo}`] })
  })
)
