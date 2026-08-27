/**
 * Scrap module (plan §P5) — scrap-sale bills (GST + TCS).
 *
 * Ported from the frontend:
 *   - store/scrapCommands.ts  (runSaveScrapBill / runDeleteScrapBill →
 *                              validateScrap / applyScrap / scrapDeleteCmd)
 *   - lib/scrapMath.ts        (computeScrap — value → GST → TCS → grand)
 *
 * Session/scope usage (writableUnitIds) is replaced by the route-layer auth
 * scope: `req.auth.allowedUnitIds` for reads, `assertUnit` for writes. All money
 * fields are integer paise; weight is integer grams so `value = rate × kg` is exact.
 */
import { Router } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, conflict, notFound } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { resolveId, nowISO } from '../../lib/id.js'
import { addP, pctOfPaise, type Paise } from '../../lib/money.js'
import { buildList, cursorList } from '../../lib/list.js'
import type { Id, ScrapBill, ScrapStatus } from '../../types/domain.js'

// ── scrap math (ported verbatim from frontend lib/scrapMath.ts) ──────────────────
interface ScrapMath {
  value: Paise
  gst: Paise
  /** value + gst (the TCS base). */
  base: Paise
  tcs: Paise
  grand: Paise
}

/** value -> GST -> TCS @ tcsPct on (value + GST) -> grand. All integer paise. */
function computeScrap(weightGrams: number, ratePerKgPaise: Paise, gstPct: number, tcsPct: number): ScrapMath {
  const value = Math.round((ratePerKgPaise * weightGrams) / 1000) as Paise
  const gst = pctOfPaise(value, gstPct)
  const base = addP(value, gst)
  const tcs = pctOfPaise(base, tcsPct)
  const grand = addP(base, tcs)
  return { value, gst, base, tcs, grand }
}

const STATUSES = ['draft', 'sent', 'paid', 'partial'] as const

// ── body schema — ports validateScrap's field rules ─────────────────────────────
const upsertSchema = z.object({
  id: z.string().optional(),
  unitId: z.string().min(1, 'Unit is required'),
  customerId: z.string().min(1, 'Customer is required'),
  periodFrom: z.string().optional().default(''),
  periodTo: z.string().optional().default(''),
  weightGrams: z
    .number()
    .int()
    .positive('Weight must be greater than 0')
    .max(1e10, 'Weight is implausibly large'), // ~10,000 t guard vs fat-finger paste
  ratePerKgPaise: z
    .number()
    .int()
    .positive('Rate per kg must be greater than 0')
    .max(1e9, 'Rate per kg is implausibly large'),
  gstPct: z.number().nonnegative(),
  tcsPct: z.number().nonnegative(),
  scrapInvoiceNo: z.string().trim().min(1, 'Invoice no. is required'),
  invoiceDate: z.string().min(1, 'Invoice date is required'),
  status: z.enum(STATUSES).optional(),
})
type UpsertBody = z.infer<typeof upsertSchema>

/** The unit scope this request may read (null = all units). */
function allowedSet(allowed: Id[] | null): Set<Id> | null {
  return allowed ? new Set(allowed) : null
}

/** Shape a scrap bill for the wire: the row + derived totals + customer name. */
function toRow(s: ReturnType<typeof getDb>, bill: ScrapBill) {
  const totals = computeScrap(bill.weightGrams, bill.ratePerKgPaise, bill.gstPct, bill.tcsPct)
  const customer = getById(s.masters.customers, bill.customerId)
  return { ...bill, customerName: customer?.name ?? '', totals }
}

/** Cross-row + referential validation (ports validateScrap's store-level checks). */
function assertValid(s: ReturnType<typeof getDb>, body: UpsertBody, selfId?: Id): void {
  if (!getById(s.masters.units, body.unitId)) throw badRequest('Unknown unit')
  if (!getById(s.masters.customers, body.customerId)) throw badRequest('Customer is required')
  if (body.periodFrom && body.periodTo && body.periodTo < body.periodFrom) {
    throw badRequest('Period "to" must be on or after period "from"')
  }
  const dup = values(s.scrap.scrapBills).some(
    (b) => b.id !== selfId && b.unitId === body.unitId && b.scrapInvoiceNo === body.scrapInvoiceNo
  )
  if (dup) throw conflict(`Scrap invoice ${body.scrapInvoiceNo} already exists`)
}

export const scrapRouter = Router()
scrapRouter.use(authenticate)

/**
 * GET / — list scrap bills (each with customer name + derived value/gst/tcs/grand
 * totals via computeScrap). Unit-scoped to the caller's allowed units. Optional
 * `?from=&to=` filters on `invoiceDate` (inclusive).
 */
scrapRouter.get(
  '/',
  requirePermission('scrap', 'view'),
  asyncHandler(async (req, res) => {
    const { from, to } = z
      .object({ from: z.string().optional(), to: z.string().optional() })
      .parse(req.query)

    const db = getDb()
    const allowed = allowedSet(req.auth!.allowedUnitIds)
    let bills = values(db.scrap.scrapBills)
    if (allowed) bills = bills.filter((b) => allowed.has(b.unitId))
    if (from || to) {
      bills = bills.filter((b) => {
        if (from && b.invoiceDate < from) return false
        if (to && b.invoiceDate > to) return false
        return true
      })
    }
    const rows = bills.map((b) => toRow(db, b))
    const searchText = (r: (typeof rows)[number]) => `${r.scrapInvoiceNo} ${r.customerName}`
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/** GET /:id — one scrap bill (row + totals), 404 if outside scope or missing. */
scrapRouter.get(
  '/:id',
  requirePermission('scrap', 'view'),
  asyncHandler(async (req, res) => {
    const db = getDb()
    const bill = getById(db.scrap.scrapBills, req.params.id)
    if (!bill) throw notFound('Scrap bill not found')
    assertUnit(req, bill.unitId)
    res.json({ data: toRow(db, bill) })
  })
)

/**
 * POST / — create a scrap bill. Ports validateScrap (field rules via the schema;
 * dup/referential guards via assertValid) + applyScrap (server-managed
 * id/createdBy/createdAt; status defaults to 'sent'). Write scope via assertUnit.
 */
scrapRouter.post(
  '/',
  requirePermission('scrap', 'create'),
  asyncHandler(async (req, res) => {
    const body = upsertSchema.parse(req.body)
    assertUnit(req, body.unitId)
    assertValid(getDb(), body)

    const bill: ScrapBill = {
      id: resolveId(body.id, (id) => !!getById(getDb().scrap.scrapBills, id), 'scr'),
      unitId: body.unitId,
      customerId: body.customerId,
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      weightGrams: body.weightGrams,
      ratePerKgPaise: body.ratePerKgPaise as Paise,
      gstPct: body.gstPct,
      tcsPct: body.tcsPct,
      scrapInvoiceNo: body.scrapInvoiceNo,
      invoiceDate: body.invoiceDate,
      status: (body.status ?? 'draft') as ScrapStatus, // editable until explicitly marked sent
      createdBy: req.auth!.user.id,
      createdAt: nowISO(),
    }
    await mutate((s) => putEntity(s.scrap.scrapBills, bill))

    const totals = computeScrap(bill.weightGrams, bill.ratePerKgPaise, bill.gstPct, bill.tcsPct)
    res.status(201).json({
      data: toRow(getDb(), bill),
      cascade: [`Scrap ${bill.scrapInvoiceNo}: ${(bill.weightGrams / 1000).toLocaleString('en-IN')} kg`, `grand ${totals.grand}`],
    })
  })
)

/**
 * PUT /:id — edit a scrap bill. Only a 'draft' bill may be edited (a sent/paid
 * bill is a printed legal document). Ports applyScrap's update path, preserving
 * the original createdBy/createdAt.
 */
scrapRouter.put(
  '/:id',
  requirePermission('scrap', 'edit'),
  asyncHandler(async (req, res) => {
    const existing = getById(getDb().scrap.scrapBills, req.params.id)
    if (!existing) throw notFound('Scrap bill not found')
    assertUnit(req, existing.unitId)
    if (existing.status !== 'draft') throw conflict('Only a draft scrap bill can be edited')

    const body = upsertSchema.parse(req.body)
    assertUnit(req, body.unitId)
    assertValid(getDb(), body, existing.id)

    const bill: ScrapBill = {
      id: existing.id,
      unitId: body.unitId,
      customerId: body.customerId,
      periodFrom: body.periodFrom,
      periodTo: body.periodTo,
      weightGrams: body.weightGrams,
      ratePerKgPaise: body.ratePerKgPaise as Paise,
      gstPct: body.gstPct,
      tcsPct: body.tcsPct,
      scrapInvoiceNo: body.scrapInvoiceNo,
      invoiceDate: body.invoiceDate,
      status: (body.status ?? existing.status) as ScrapStatus,
      createdBy: existing.createdBy,
      createdAt: existing.createdAt,
    }
    await mutate((s) => putEntity(s.scrap.scrapBills, bill))

    res.json({
      data: toRow(getDb(), bill),
      cascade: [`Updated scrap bill ${bill.scrapInvoiceNo}`],
    })
  })
)

/** DELETE /:id — remove a scrap bill (ports scrapDeleteCmd). */
scrapRouter.delete(
  '/:id',
  requirePermission('scrap', 'delete'),
  asyncHandler(async (req, res) => {
    const bill = getById(getDb().scrap.scrapBills, req.params.id)
    if (!bill) throw notFound('Scrap bill not found')
    assertUnit(req, bill.unitId)

    await mutate((s) => removeEntity(s.scrap.scrapBills, bill.id))
    res.json({
      data: { id: bill.id },
      cascade: [`Scrap bill ${bill.scrapInvoiceNo} deleted`],
    })
  })
)
