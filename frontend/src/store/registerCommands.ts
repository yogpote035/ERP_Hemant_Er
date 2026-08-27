/**
 * Inward / Outward register commands (plan §7 P2) — the make-or-break core.
 *
 * `saveOutwardDispatch` is the "one action → many effects" transaction:
 *   1 dispatch row written, rate + GST snapshotted, a DRAFT invoice
 *   created-or-attached per (unit, Bill No) (FR-BI01), stock re-derived, and the
 *   whole thing atomic + undoable + logged. Over-dispatch (invariant I1) is
 *   rejected at write time, not just flagged by reconcile.
 */
import type { Dispatch, DispatchKind, Id, ISODate, Inward } from '@/types/domain'
import type { Paise } from '@/lib/money'
import { fyOf } from '@/lib/fy'
import { getById, putEntity, removeEntity, values } from './normalized'
import { writableUnitIds } from './scope'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

// ── inputs ────────────────────────────────────────────────────────────────────
export interface InwardInput {
  id?: Id
  unitId: Id
  partId: Id
  vendorId?: Id
  customerId?: Id
  challanNo: string
  challanDate: ISODate
  poNo?: string
  dieNo?: string
  batchHeatNo: string
  binNo?: string
  rmRatePaise?: Paise
  rmWtMg?: number
  finishWtMg?: number
  receivedQty: number
  remarks?: string
}

export interface DispatchInput {
  id?: Id
  inwardId: Id
  kind: DispatchKind
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

// ── helpers ─────────────────────────────────────────────────────────────────────
const lineTotal = (ok: number, mc: number, mf: number): number => ok + mc + mf

/** Qty already consumed against an inward, optionally excluding one dispatch (for edits). */
function consumedForInward(s: RootState, inwardId: Id, exceptId?: Id): number {
  return values(s.inventory.dispatches)
    .filter((d) => d.inwardId === inwardId && d.id !== exceptId)
    .reduce((a, d) => a + d.okQty + d.mcRejQty + d.mfQty, 0)
}

function parseSeq(billNo: string): number {
  const n = parseInt(billNo, 10)
  return Number.isNaN(n) ? 0 : n
}

/**
 * Make the dispatch's invoice links match its current Bill No: detach it from
 * any invoice it no longer belongs to (deleting an emptied draft), then attach
 * (creating a draft if needed) to invoice (unit, Bill No). Rejection / no-bill
 * dispatches end up linked to nothing. Returns the linked Bill No, if any.
 */
function relinkInvoice(draft: RootState, dispatch: Dispatch, inward: Inward, ctx: CommandContext): string | null {
  const wantBill = dispatch.kind === 'billed' && dispatch.billNo ? dispatch.billNo : null

  for (const inv of values(draft.billing.invoices)) {
    // Only ever touch DRAFT invoices — an issued (sent) invoice is immutable
    // (validateDispatch blocks edits/attaches that would reach a sent invoice).
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
    const date = dispatch.billDate ?? dispatch.dispatchDate ?? ctx.today
    target = {
      id: ctx.newId('inv'),
      unitId: inward.unitId,
      issuerKind: 'unit',
      issuerId: inward.unitId,
      billNo: wantBill,
      fy: fyOf(date),
      seq: parseSeq(wantBill),
      invoiceDate: date,
      dispatchIds: [],
      lifecycle: 'draft',
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
    }
    putEntity(draft.billing.invoices, target)
  }
  if (!target.dispatchIds.includes(dispatch.id)) target.dispatchIds.push(dispatch.id)
  return target.billNo
}

// ── inward ────────────────────────────────────────────────────────────────────
function validateInward(s: RootState, input: InwardInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!input.unitId) errors.push('Unit is required')
  if (!input.partId) errors.push('Part is required')
  if (!input.challanNo.trim()) errors.push('Challan no. is required')
  if (!input.challanDate) errors.push('Challan date is required')
  if (!input.batchHeatNo.trim()) errors.push('Batch / heat no. is required')
  if (!(input.receivedQty > 0)) errors.push('Received qty must be greater than 0')
  if (input.unitId && !writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  // Duplicate-challan guard: one (unit, challan, part) row only.
  const dup = values(s.inventory.inwards).some(
    (i) => i.id !== input.id && i.unitId === input.unitId && i.partId === input.partId && i.challanNo === input.challanNo
  )
  if (dup) errors.push(`Challan ${input.challanNo} already exists for this part`)
  // On edit, can't shrink received below what's already dispatched, and the row
  // can't be moved out of a unit the actor can't write (defensive: read scope ⊆
  // write scope today, but don't rely on that staying true).
  if (input.id) {
    const existing = getById(s.inventory.inwards, input.id)
    if (existing && !writableUnitIds(s).has(existing.unitId)) {
      errors.push("You don't have access to this challan's current unit")
    }
    const consumed = consumedForInward(s, input.id)
    if (input.receivedQty < consumed) errors.push(`Received qty can't be below dispatched (${consumed})`)
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyInward(draft: RootState, input: InwardInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('inw')
  const existing = input.id ? getById(draft.inventory.inwards, input.id) : undefined
  const inward: Inward = {
    id,
    unitId: input.unitId,
    partId: input.partId,
    vendorId: input.vendorId,
    customerId: input.customerId,
    challanNo: input.challanNo.trim(),
    challanDate: input.challanDate,
    poNo: input.poNo,
    dieNo: input.dieNo,
    batchHeatNo: input.batchHeatNo.trim(),
    binNo: input.binNo,
    rmRatePaise: input.rmRatePaise,
    rmWtMg: input.rmWtMg,
    finishWtMg: input.finishWtMg,
    receivedQty: input.receivedQty,
    remarks: input.remarks,
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.inventory.inwards, inward)
  return {
    result: { id },
    cascade: [`Inward ${inward.challanNo} · ${inward.receivedQty.toLocaleString('en-IN')} pcs`],
    summary: `${existing ? 'Updated' : 'Saved'} inward ${inward.challanNo}`,
    refs: [{ type: 'inward', id }],
    unitId: inward.unitId,
  }
}

const inwardCreate: Command<InwardInput, { id: Id }> = {
  name: 'saveInward', module: 'inward', action: 'create', validate: validateInward, apply: applyInward,
}
const inwardEdit: Command<InwardInput, { id: Id }> = {
  name: 'saveInward', module: 'inward', action: 'edit', validate: validateInward, apply: applyInward,
}

export function runSaveInward(input: InwardInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? inwardEdit : inwardCreate, input)
}

const inwardDelete: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteEntity',
  module: 'inward',
  action: 'delete',
  validate(s, input) {
    const inw = getById(s.inventory.inwards, input.id)
    if (!inw) return { ok: false, errors: ['Inward not found'] }
    if (!writableUnitIds(s).has(inw.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    const children = consumedForInward(s, input.id)
    if (children > 0) return { ok: false, errors: ['Remove its dispatches before deleting this challan'] }
    // Rejection advices reference this challan via sourceInwardId but don't consume stock,
    // so they slip past the dispatch guard — block the delete to avoid a dangling link.
    const rejRefs = values(s.rejection.rejectionAdvices).filter((r) => r.sourceInwardId === input.id).length
    if (rejRefs > 0) return { ok: false, errors: ['Remove its rejection advices before deleting this challan'] }
    return { ok: true }
  },
  apply(draft, input) {
    const inw = getById(draft.inventory.inwards, input.id) as Inward
    removeEntity(draft.inventory.inwards, input.id)
    return {
      result: { id: input.id },
      cascade: [`Inward ${inw.challanNo} deleted`],
      summary: `Deleted inward ${inw.challanNo}`,
      refs: [{ type: 'inward', id: input.id }],
      unitId: inw.unitId,
    }
  },
}

export function runDeleteInward(id: Id): CommandResult<{ id: Id }> {
  return runCommand(inwardDelete, { id })
}

// ── outward dispatch (the centerpiece) ─────────────────────────────────────────
function validateDispatch(s: RootState, input: DispatchInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const inward = getById(s.inventory.inwards, input.inwardId)
  if (!inward) return { ok: false, errors: ['Inward challan not found'] }
  if (!writableUnitIds(s).has(inward.unitId)) errors.push("You don't have access to that unit")

  const ok = input.okQty || 0
  const mc = input.mcRejQty || 0
  const mf = input.mfQty || 0
  if (ok < 0 || mc < 0 || mf < 0) errors.push('Quantities cannot be negative')
  if (!Number.isInteger(ok) || !Number.isInteger(mc) || !Number.isInteger(mf)) errors.push('Ring quantities must be whole numbers')
  const total = lineTotal(ok, mc, mf)
  if (total <= 0) errors.push('Enter at least one quantity')

  // I1 — never dispatch more than the challan received.
  const available = inward.receivedQty - consumedForInward(s, input.inwardId, input.id)
  if (total > available) errors.push(`Over-dispatch: only ${available.toLocaleString('en-IN')} available on this challan`)

  // Issued invoices are immutable: block editing a dispatch that already sits on
  // a non-draft (sent) invoice, and block billing onto a bill no. already issued.
  const invoices = values(s.billing.invoices)
  if (input.id) {
    const owning = invoices.find((inv) => inv.dispatchIds.includes(input.id as Id))
    if (owning && owning.lifecycle !== 'draft') {
      errors.push(`This dispatch is on issued bill ${owning.billNo}; void it before editing`)
    }
  }

  if (input.kind === 'billed') {
    const billNo = input.billNo?.trim()
    if (!billNo) errors.push('Bill no. is required for a billed dispatch')
    if (!(input.ratePaise != null && input.ratePaise > 0)) errors.push('Rate is required for a billed dispatch')
    if (billNo) {
      const clash = invoices.find(
        (inv) => inv.unitId === inward.unitId && inv.billNo === billNo && inv.lifecycle !== 'draft'
      )
      if (clash) errors.push(`Bill ${billNo} is already issued — choose another bill no. or void it`)
    }
    const part = getById(s.masters.parts, inward.partId)
    if (!part || part.gstPct == null) errors.push('The part has no GST% configured for a billed line')
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyDispatch(draft: RootState, input: DispatchInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('dsp')
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
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.inventory.dispatches, dispatch)

  const linkedBill = relinkInvoice(draft, dispatch, inward, ctx)
  const total = lineTotal(dispatch.okQty, dispatch.mcRejQty, dispatch.mfQty)

  // Derived closing stock for the part after this write (for the rich toast).
  const partInwardIds = new Set(
    values(draft.inventory.inwards).filter((i) => i.unitId === inward.unitId && i.partId === inward.partId).map((i) => i.id)
  )
  const consumed = values(draft.inventory.dispatches)
    .filter((d) => partInwardIds.has(d.inwardId))
    .reduce((a, d) => a + d.okQty + d.mcRejQty + d.mfQty, 0)
  const received = values(draft.inventory.inwards)
    .filter((i) => partInwardIds.has(i.id))
    .reduce((a, i) => a + i.receivedQty, 0)
  const opening = values(draft.masters.stockOpenings)
    .filter((o) => o.unitId === inward.unitId && o.partId === inward.partId)
    .reduce((a, o) => a + o.openingQty, 0)
  const closing = opening + received - consumed

  const cascade = [
    `${total.toLocaleString('en-IN')} pcs dispatched on ${inward.challanNo}`,
    billed ? `attached to draft bill ${linkedBill}` : 'rejection / return (not billed)',
    `${part?.partNo ?? 'part'} stock → ${closing.toLocaleString('en-IN')}`,
  ]
  return {
    result: { id },
    cascade,
    summary: `${existing ? 'Updated' : 'Saved'} ${billed ? 'dispatch' : 'rejection'} ${total} pcs on ${inward.challanNo}`,
    refs: [{ type: 'dispatch', id }, { type: 'inward', id: inward.id }],
    unitId: inward.unitId,
  }
}

const dispatchCreate: Command<DispatchInput, { id: Id }> = {
  name: 'saveOutwardDispatch', module: 'dispatch', action: 'create', validate: validateDispatch, apply: applyDispatch,
}
const dispatchEdit: Command<DispatchInput, { id: Id }> = {
  name: 'saveOutwardDispatch', module: 'dispatch', action: 'edit', validate: validateDispatch, apply: applyDispatch,
}

export function runSaveDispatch(input: DispatchInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? dispatchEdit : dispatchCreate, input)
}

// ── batch outward entry (multi-line form) ──────────────────────────────────────
export interface DispatchBatchLine {
  kind: DispatchKind
  okQty: number
  mcRejQty: number
  mfQty: number
  billNo?: string
  billDate?: ISODate
  dispatchDate?: ISODate
  ratePaise?: Paise
  custInvoiceNo?: string
}

export interface DispatchBatchInput {
  inwardId: Id
  lines: DispatchBatchLine[]
}

/**
 * Save several dispatch lines against one challan as a SINGLE atomic, undoable
 * command (the mock's "Save & update stock"). Over-dispatch (I1) is enforced on
 * the CUMULATIVE batch total, not per line, so two lines can't each pass the
 * available check yet jointly exceed it.
 */
function validateDispatchBatch(s: RootState, input: DispatchBatchInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  const inward = getById(s.inventory.inwards, input.inwardId)
  if (!inward) return { ok: false, errors: ['Inward challan not found'] }
  if (!writableUnitIds(s).has(inward.unitId)) errors.push("You don't have access to that unit")
  if (input.lines.length === 0) errors.push('Add at least one dispatch line')

  const invoices = values(s.billing.invoices)
  const part = getById(s.masters.parts, inward.partId)
  let batchTotal = 0
  input.lines.forEach((ln, i) => {
    const ok = ln.okQty || 0
    const mc = ln.mcRejQty || 0
    const mf = ln.mfQty || 0
    if (ok < 0 || mc < 0 || mf < 0) errors.push(`Line ${i + 1}: quantities cannot be negative`)
    if (!Number.isInteger(ok) || !Number.isInteger(mc) || !Number.isInteger(mf)) errors.push(`Line ${i + 1}: ring quantities must be whole numbers`)
    const total = lineTotal(ok, mc, mf)
    if (total <= 0) errors.push(`Line ${i + 1}: enter at least one quantity`)
    batchTotal += total
    if (ln.kind === 'billed') {
      const billNo = ln.billNo?.trim()
      if (!billNo) errors.push(`Line ${i + 1}: bill no. is required for a billed line`)
      if (!(ok > 0)) errors.push(`Line ${i + 1}: a billed line needs OK qty to bill`)
      if (!(ln.ratePaise != null && ln.ratePaise > 0)) errors.push(`Line ${i + 1}: rate is required for a billed line`)
      if (!part || part.gstPct == null) errors.push(`Line ${i + 1}: the part has no GST% configured`)
      if (billNo) {
        const clash = invoices.find((inv) => inv.unitId === inward.unitId && inv.billNo === billNo && inv.lifecycle !== 'draft')
        if (clash) errors.push(`Line ${i + 1}: bill ${billNo} is already issued — void it first`)
      }
    }
  })

  const available = inward.receivedQty - consumedForInward(s, input.inwardId)
  if (batchTotal > available) {
    errors.push(`Over-dispatch: ${batchTotal.toLocaleString('en-IN')} entered but only ${available.toLocaleString('en-IN')} available`)
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyDispatchBatch(draft: RootState, input: DispatchBatchInput, ctx: CommandContext): ApplyOut<{ ids: Id[] }> {
  const inward = getById(draft.inventory.inwards, input.inwardId) as Inward
  const part = getById(draft.masters.parts, inward.partId)
  const ids: Id[] = []
  const bills = new Set<string>()
  let totalPcs = 0
  for (const ln of input.lines) {
    const lineInput: DispatchInput = {
      inwardId: input.inwardId,
      kind: ln.kind,
      okQty: ln.okQty || 0,
      mcRejQty: ln.mcRejQty || 0,
      mfQty: ln.mfQty || 0,
      billNo: ln.billNo,
      billDate: ln.billDate,
      dispatchDate: ln.dispatchDate,
      ratePaise: ln.ratePaise,
      custInvoiceNo: ln.custInvoiceNo,
    }
    const out = applyDispatch(draft, lineInput, ctx)
    ids.push(out.result.id)
    totalPcs += (ln.okQty || 0) + (ln.mcRejQty || 0) + (ln.mfQty || 0)
    if (ln.kind === 'billed' && ln.billNo?.trim()) bills.add(ln.billNo.trim())
  }

  const cascade = [
    `${input.lines.length} line${input.lines.length === 1 ? '' : 's'} · ${totalPcs.toLocaleString('en-IN')} pcs on ${inward.challanNo}`,
    bills.size > 0 ? `draft bill${bills.size === 1 ? '' : 's'} ${[...bills].join(', ')}` : 'rejection / return only (not billed)',
  ]
  return {
    result: { ids },
    cascade,
    summary: `Saved ${input.lines.length} dispatch line${input.lines.length === 1 ? '' : 's'} on ${inward.challanNo} (${part?.partNo ?? 'part'})`,
    refs: [{ type: 'inward', id: inward.id }, ...ids.map((id) => ({ type: 'dispatch', id }))],
    unitId: inward.unitId,
  }
}

const dispatchBatch: Command<DispatchBatchInput, { ids: Id[] }> = {
  name: 'saveOutwardDispatch', module: 'dispatch', action: 'create', validate: validateDispatchBatch, apply: applyDispatchBatch,
}

export function runSaveDispatchBatch(input: DispatchBatchInput): CommandResult<{ ids: Id[] }> {
  return runCommand(dispatchBatch, input)
}

const dispatchDelete: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteEntity',
  module: 'dispatch',
  action: 'delete',
  validate(s, input) {
    const dsp = getById(s.inventory.dispatches, input.id)
    if (!dsp) return { ok: false, errors: ['Dispatch not found'] }
    const inward = getById(s.inventory.inwards, dsp.inwardId)
    if (inward && !writableUnitIds(s).has(inward.unitId)) {
      return { ok: false, errors: ["You don't have access to that unit"] }
    }
    const owning = values(s.billing.invoices).find((inv) => inv.dispatchIds.includes(input.id))
    if (owning && owning.lifecycle !== 'draft') {
      return { ok: false, errors: [`On issued bill ${owning.billNo}; void it before deleting`] }
    }
    return { ok: true }
  },
  apply(draft, input) {
    const dsp = getById(draft.inventory.dispatches, input.id) as Dispatch
    const inward = getById(draft.inventory.inwards, dsp.inwardId)
    // Unlink from any invoice (deleting an emptied draft), then remove the row.
    for (const inv of values(draft.billing.invoices)) {
      if (inv.dispatchIds.includes(input.id)) {
        inv.dispatchIds = inv.dispatchIds.filter((x) => x !== input.id)
        if (inv.dispatchIds.length === 0 && inv.lifecycle === 'draft') removeEntity(draft.billing.invoices, inv.id)
      }
    }
    removeEntity(draft.inventory.dispatches, input.id)
    return {
      result: { id: input.id },
      cascade: ['Dispatch removed; stock restored'],
      summary: `Deleted dispatch on ${inward?.challanNo ?? '—'}`,
      refs: [{ type: 'dispatch', id: input.id }],
      unitId: inward?.unitId,
    }
  },
}

export function runDeleteDispatch(id: Id): CommandResult<{ id: Id }> {
  return runCommand(dispatchDelete, { id })
}
