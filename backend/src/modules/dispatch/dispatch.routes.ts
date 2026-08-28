/**
 * Dispatch (outward register) module — phase 2.
 *
 * Ported from frontend_2.0/src/store/registerCommands.ts
 *   (saveOutwardDispatch / runSaveDispatchBatch) and
 *   frontend_2.0/src/selectors/stock.ts (selectAvailableForInward).
 *
 * POST / is the "one action → many effects" transaction: it writes one or a
 * BATCH of dispatch lines under one inward challan, snapshots rate + GST%, and
 * creates-or-attaches a DRAFT invoice per (unit, Bill No) (FR-BI01). Over-dispatch
 * (invariant I1) is rejected at write time on the CUMULATIVE batch total so two
 * lines can't each pass the available check yet jointly exceed it.
 *
 * Money fields are integer paise. Unit scope comes from the parent inward's unit.
 */
import { Router, type Request } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity, removeEntity } from '../../db/normalized.js'
import { asyncHandler, badRequest, notFound, forbidden } from '../../lib/http.js'
import { authenticate, requirePermission, canAccessUnit } from '../../auth/middleware.js'
import { genId, nowISO, todayISO } from '../../lib/id.js'
import { fyOf } from '../../lib/fy.js'
import { selectAvailableForInward, dispatchTotalQty } from '../../domain/stock.js'
import type { RootState } from '../../db/state.js'
import type { Dispatch, Id, ISODate, Inward, Invoice } from '../../types/domain.js'
import type { Paise } from '../../lib/money.js'
import { buildList, cursorList } from '../../lib/list.js'

// ── helpers ─────────────────────────────────────────────────────────────────────
const lineTotal = (ok: number, mc: number, mf: number): number => ok + mc + mf

function parseSeq(billNo: string): number {
  const n = parseInt(billNo, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Make the dispatch's invoice links match its current Bill No: detach it from
 * any DRAFT invoice it no longer belongs to (deleting an emptied draft), then
 * attach (creating a draft if needed) to invoice (unit, Bill No). Rejection /
 * no-bill dispatches end up linked to nothing. Returns the linked Bill No, if any.
 */
function relinkInvoice(
  draft: RootState,
  dispatch: Dispatch,
  inward: Inward,
  actorId: Id,
  now: ISODate,
  today: ISODate
): string | null {
  const wantBill = dispatch.kind === 'billed' && dispatch.billNo ? dispatch.billNo : null

  for (const inv of values(draft.billing.invoices)) {
    // Only ever touch DRAFT invoices — an issued (sent) invoice is immutable.
    if (inv.lifecycle !== 'draft') continue
    const has = inv.dispatchIds.includes(dispatch.id)
    const shouldHave = wantBill !== null && inv.unitId === inward.unitId && inv.billNo === wantBill
    if (has && !shouldHave) {
      inv.dispatchIds = inv.dispatchIds.filter((id) => id !== dispatch.id)
      if (inv.dispatchIds.length === 0) removeEntity(draft.billing.invoices, inv.id)
    }
  }
  if (wantBill === null) return null

  let target = values(draft.billing.invoices).find(
    (inv) => inv.unitId === inward.unitId && inv.billNo === wantBill && inv.lifecycle === 'draft'
  )
  if (!target) {
    const date = dispatch.billDate ?? dispatch.dispatchDate ?? today
    target = {
      id: genId('inv'),
      unitId: inward.unitId,
      issuerKind: 'unit',
      issuerId: inward.unitId,
      billNo: wantBill,
      fy: fyOf(date),
      seq: parseSeq(wantBill),
      invoiceDate: date,
      dispatchIds: [],
      lifecycle: 'draft',
      createdBy: actorId,
      createdAt: now,
    } satisfies Invoice
    putEntity(draft.billing.invoices, target)
  }
  if (!target.dispatchIds.includes(dispatch.id)) target.dispatchIds.push(dispatch.id)
  return target.billNo
}

// ── inputs ────────────────────────────────────────────────────────────────────
interface DispatchInput {
  id?: Id
  inwardId: Id
  kind: Dispatch['kind']
  okQty: number
  mcRejQty: number
  mfQty: number
  billNo?: string
  billDate?: ISODate
  dispatchDate?: ISODate
  ratePaise?: Paise
  custInvoiceNo?: string
  custInvoiceDate?: ISODate
  remarks?: string
}

/**
 * Validate one dispatch line against current state. `available` is the qty free
 * on this challan EXCLUDING the line being edited; for a batch the caller passes
 * the per-line check separately and enforces the cumulative cap itself.
 */
function validateLine(
  s: RootState,
  input: DispatchInput,
  inward: Inward,
  errors: string[],
  label: string
): void {
  const ok = input.okQty || 0
  const mc = input.mcRejQty || 0
  const mf = input.mfQty || 0
  if (ok < 0 || mc < 0 || mf < 0) errors.push(`${label}quantities cannot be negative`)
  if (!Number.isInteger(ok) || !Number.isInteger(mc) || !Number.isInteger(mf))
    errors.push(`${label}ring quantities must be whole numbers`)
  const total = lineTotal(ok, mc, mf)
  if (total <= 0) errors.push(`${label}enter at least one quantity`)

  // Issued invoices are immutable: block editing a dispatch already on a sent bill.
  if (input.id) {
    const owning = values(s.billing.invoices).find((inv) => inv.dispatchIds.includes(input.id as Id))
    if (owning && owning.lifecycle !== 'draft')
      errors.push(`${label}this dispatch is on issued bill ${owning.billNo}; void it before editing`)
  }

  if (input.kind === 'billed') {
    const billNo = input.billNo?.trim()
    if (!billNo) errors.push(`${label}bill no. is required for a billed line`)
    if (!(input.ratePaise != null && input.ratePaise > 0)) errors.push(`${label}rate is required for a billed line`)
    const part = getById(s.masters.parts, inward.partId)
    if (!part || part.gstPct == null) errors.push(`${label}the part has no GST% configured for a billed line`)
    if (billNo) {
      const clash = values(s.billing.invoices).find(
        (inv) => inv.unitId === inward.unitId && inv.billNo === billNo && inv.lifecycle !== 'draft'
      )
      if (clash) errors.push(`${label}bill ${billNo} is already issued — choose another bill no. or void it`)
    }
  }
}

/**
 * Write one dispatch line into `draft`, snapshotting rate + GST% and relinking
 * its draft invoice. Returns the saved row + the linked bill (if billed).
 */
function applyLine(
  draft: RootState,
  input: DispatchInput,
  actorId: Id,
  now: ISODate,
  today: ISODate
): { dispatch: Dispatch; linkedBill: string | null } {
  const id = input.id ?? genId('dsp')
  const inward = getById(draft.inventory.inwards, input.inwardId) as Inward
  const part = getById(draft.masters.parts, inward.partId)
  const existing = input.id ? getById(draft.inventory.dispatches, input.id) : undefined
  const billed = input.kind === 'billed'

  const dispatch: Dispatch = {
    id,
    inwardId: input.inwardId,
    kind: input.kind,
    okQty: input.okQty || 0,
    mcRejQty: input.mcRejQty || 0,
    mfQty: input.mfQty || 0,
    billNo: input.billNo?.trim() || undefined,
    billDate: input.billDate,
    dispatchDate: input.dispatchDate,
    rateSnapshotPaise: billed ? input.ratePaise : undefined,
    // GST% is snapshotted at the ORIGINAL dispatch — preserve it on edit so a
    // later change to the part's gstPct can't silently re-stamp history.
    gstPctSnapshot: billed ? existing?.gstPctSnapshot ?? part?.gstPct : undefined,
    custInvoiceNo: input.custInvoiceNo,
    custInvoiceDate: input.custInvoiceDate,
    remarks: input.remarks,
    createdBy: existing?.createdBy ?? actorId,
    createdAt: existing?.createdAt ?? now,
  }
  putEntity(draft.inventory.dispatches, dispatch)
  const linkedBill = relinkInvoice(draft, dispatch, inward, actorId, now, today)
  return { dispatch, linkedBill }
}

/** Closing stock for the part owning `inward`, derived after writes. */
function closingStock(s: RootState, inward: Inward): number {
  const partInwardIds = new Set(
    values(s.inventory.inwards)
      .filter((i) => i.unitId === inward.unitId && i.partId === inward.partId)
      .map((i) => i.id)
  )
  const consumed = values(s.inventory.dispatches)
    .filter((d) => partInwardIds.has(d.inwardId))
    .reduce((a, d) => a + dispatchTotalQty(d), 0)
  const received = values(s.inventory.inwards)
    .filter((i) => partInwardIds.has(i.id))
    .reduce((a, i) => a + i.receivedQty, 0)
  const opening = values(s.masters.stockOpenings)
    .filter((o) => o.unitId === inward.unitId && o.partId === inward.partId)
    .reduce((a, o) => a + o.openingQty, 0)
  return opening + received - consumed
}

// ── request schemas ─────────────────────────────────────────────────────────────
const lineSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(['billed', 'rejection']),
  okQty: z.number().int().min(0).default(0),
  mcRejQty: z.number().int().min(0).default(0),
  mfQty: z.number().int().min(0).default(0),
  billNo: z.string().optional(),
  billDate: z.string().optional(),
  dispatchDate: z.string().optional(),
  ratePaise: z.number().int().min(0).optional(),
  custInvoiceNo: z.string().optional(),
  custInvoiceDate: z.string().optional(),
  remarks: z.string().optional(),
})

// Accept either a single line under `inwardId`, or a batch `{ inwardId, lines }`.
const bodySchema = z.union([
  z.object({ inwardId: z.string().min(1), lines: z.array(lineSchema).min(1) }),
  lineSchema.extend({ inwardId: z.string().min(1) }),
])

// ── router ──────────────────────────────────────────────────────────────────────
export const dispatchRouter = Router()
dispatchRouter.use(authenticate)

/** Full Indian financial-year label used by delivery challans (April–March). */
function dcFinancialYear(date: string): string {
  const match = /^(\d{4})-(\d{2})-\d{2}$/.exec(date)
  if (!match) throw badRequest('A valid D/C date is required')
  const calendarYear = Number(match[1])
  const month = Number(match[2])
  if (month < 1 || month > 12) throw badRequest('A valid D/C date is required')
  const startYear = month >= 4 ? calendarYear : calendarYear - 1
  return `${startYear}-${String(startYear + 1).slice(-2)}`
}

/** Reserve the next company D/C number for an outward-entry batch. */
dispatchRouter.post(
  '/next-dc',
  requirePermission('dispatch', 'create'),
  asyncHandler(async (req, res) => {
    const { date } = z.object({ date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) }).parse(req.body)
    const fy = dcFinancialYear(date)
    const dcNo = await mutate((state) => {
      // A separate counter per FY automatically resets the visible number to 01
      // every April while preserving older challan sequences.
      const key = `dispatch:dc:${fy}`
      const stored = state.system.sequences[key] ?? 0
      const existingMax = values(state.inventory.dispatches).reduce((max, dispatch) => {
        const match = /^(\d+)\/(\d{4}-\d{2})$/.exec(dispatch.billNo ?? '')
        return match?.[2] === fy ? Math.max(max, Number(match[1])) : max
      }, 0)
      const next = Math.max(stored, existingMax) + 1
      state.system.sequences[key] = next
      return `${String(next).padStart(2, '0')}/${fy}`
    })
    res.status(201).json({ data: { dcNo } })
  })
)

/** GET / — list dispatches; scoped via parent inward's unit. Optional ?inwardId=. */
dispatchRouter.get(
  '/',
  requirePermission('dispatch', 'view'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const filterInward = typeof req.query.inwardId === 'string' ? req.query.inwardId : undefined
    const rows = values(s.inventory.dispatches).filter((d) => {
      if (filterInward && d.inwardId !== filterInward) return false
      const inward = getById(s.inventory.inwards, d.inwardId)
      return canAccessUnit(req as Request, inward?.unitId)
    })
    const searchText = (r: (typeof rows)[number]) => `${r.billNo ?? ''} ${r.custInvoiceNo ?? ''} ${r.remarks ?? ''}`
    if (req.query.mode === 'cursor') res.json(cursorList(rows, req.query, { idOf: (r) => r.id, searchText }))
    else res.json(buildList(rows, req.query, searchText))
  })
)

/**
 * POST / — save one dispatch line, or a BATCH of lines, under one inward challan.
 * Validates okQty+mcRejQty+mfQty does not exceed available (cumulative across the
 * batch), snapshots rate + GST%, and creates/attaches the draft invoice(s).
 */
dispatchRouter.post(
  '/',
  requirePermission('dispatch', 'create'),
  asyncHandler(async (req, res) => {
    const parsed = bodySchema.parse(req.body)
    const inwardId = parsed.inwardId
    const isBatch = 'lines' in parsed
    const lines: DispatchInput[] = ('lines' in parsed ? parsed.lines : [parsed]).map((ln) => ({
      id: ln.id,
      inwardId,
      kind: ln.kind,
      okQty: ln.okQty,
      mcRejQty: ln.mcRejQty,
      mfQty: ln.mfQty,
      billNo: ln.billNo,
      billDate: ln.billDate,
      dispatchDate: ln.dispatchDate,
      ratePaise: ln.ratePaise as Paise | undefined,
      custInvoiceNo: ln.custInvoiceNo,
      custInvoiceDate: ln.custInvoiceDate,
      remarks: ln.remarks,
    }))

    const s = getDb()
    const inward = getById(s.inventory.inwards, inwardId)
    if (!inward) throw notFound('Inward challan not found')
    if (!canAccessUnit(req as Request, inward.unitId)) throw forbidden("You don't have access to that unit")

    // Validate every line, then enforce over-dispatch (I1) on the cumulative total.
    const errors: string[] = []
    let batchTotal = 0
    lines.forEach((ln, i) => {
      const label = isBatch ? `Line ${i + 1}: ` : ''
      validateLine(s, ln, inward, errors, label)
      batchTotal += lineTotal(ln.okQty || 0, ln.mcRejQty || 0, ln.mfQty || 0)
    })
    // selectAvailableForInward = received − Σ(all consumed). On a single-line edit
    // add the edited line's existing qty back so it isn't counted against itself.
    const exceptId = !isBatch ? lines[0].id : undefined
    const editedExisting = exceptId ? getById(s.inventory.dispatches, exceptId) : undefined
    const available =
      selectAvailableForInward(s, inwardId) + (editedExisting ? dispatchTotalQty(editedExisting) : 0)
    if (batchTotal > available) {
      errors.push(
        `Over-dispatch: ${batchTotal.toLocaleString('en-IN')} entered but only ${available.toLocaleString('en-IN')} available on this challan`
      )
    }
    if (errors.length) throw badRequest('Dispatch rejected', errors)

    const actorId = req.auth!.user.id
    const now = nowISO()
    const today = todayISO()

    const result = await mutate((draft) => {
      const freshInward = getById(draft.inventory.inwards, inwardId) as Inward
      const saved: Dispatch[] = []
      const bills = new Set<string>()
      let totalPcs = 0
      for (const ln of lines) {
        const { dispatch, linkedBill } = applyLine(draft, ln, actorId, now, today)
        saved.push(dispatch)
        totalPcs += dispatchTotalQty(dispatch)
        if (linkedBill) bills.add(linkedBill)
      }
      const part = getById(draft.masters.parts, freshInward.partId)
      const closing = closingStock(draft, freshInward)
      const cascade = isBatch
        ? [
            `${lines.length} line${lines.length === 1 ? '' : 's'} · ${totalPcs.toLocaleString('en-IN')} pcs on ${freshInward.challanNo}`,
            bills.size > 0
              ? `draft bill${bills.size === 1 ? '' : 's'} ${[...bills].join(', ')}`
              : 'rejection / return only (not billed)',
            `${part?.partNo ?? 'part'} stock → ${closing.toLocaleString('en-IN')}`,
          ]
        : [
            `${totalPcs.toLocaleString('en-IN')} pcs dispatched on ${freshInward.challanNo}`,
            bills.size > 0 ? `attached to draft bill ${[...bills][0]}` : 'rejection / return (not billed)',
            `${part?.partNo ?? 'part'} stock → ${closing.toLocaleString('en-IN')}`,
          ]
      return { saved, cascade }
    })

    const data = isBatch ? result.saved : result.saved[0]
    res.status(201).json({ data, cascade: result.cascade })
  })
)

/**
 * DELETE /:id — remove a dispatch line and restore stock. Blocked when the line
 * sits on an ISSUED (non-draft) invoice — void it first. On delete the line is
 * unlinked from any draft invoice, and a now-empty draft is removed.
 */
dispatchRouter.delete(
  '/:id',
  requirePermission('dispatch', 'delete'),
  asyncHandler(async (req, res) => {
    const s = getDb()
    const dsp = getById(s.inventory.dispatches, req.params.id)
    if (!dsp) throw notFound('Dispatch not found')
    const inward = getById(s.inventory.inwards, dsp.inwardId)
    if (!canAccessUnit(req as Request, inward?.unitId)) throw forbidden("You don't have access to that unit")
    const owning = values(s.billing.invoices).find((inv) => inv.dispatchIds.includes(dsp.id))
    if (owning && owning.lifecycle !== 'draft') {
      throw badRequest(`On issued bill ${owning.billNo}; void it before deleting`)
    }
    await mutate((draft) => {
      for (const inv of values(draft.billing.invoices)) {
        if (inv.dispatchIds.includes(dsp.id)) {
          inv.dispatchIds = inv.dispatchIds.filter((x) => x !== dsp.id)
          if (inv.dispatchIds.length === 0 && inv.lifecycle === 'draft') removeEntity(draft.billing.invoices, inv.id)
        }
      }
      removeEntity(draft.inventory.dispatches, dsp.id)
    })
    res.json({ data: { id: dsp.id, deleted: true }, cascade: ['Dispatch removed; stock restored'] })
  })
)
