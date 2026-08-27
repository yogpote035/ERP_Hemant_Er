/**
 * scrapCommands.ts (plan P5) — scrap sale bills (GST + TCS) and rejection-advice
 * delivery challans. Both are simple single-collection writes through the bus
 * (atomic + undoable + logged); the money/weight is derived for the toast.
 */
import type { Id, ISODate, RejectionAdvice, RejectionWeightBasis, ScrapBill, ScrapStatus } from '@/types/domain'
import type { Paise } from '@/lib/money'
import { formatINRSymbol } from '@/lib/money'
import { computeScrap } from '@/lib/scrapMath'
import { getById, putEntity, removeEntity, values } from './normalized'
import { writableUnitIds } from './scope'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

// ── scrap bill ───────────────────────────────────────────────────────────────
export interface ScrapInput {
  id?: Id
  unitId: Id
  customerId: Id
  periodFrom: ISODate
  periodTo: ISODate
  weightGrams: number
  ratePerKgPaise: Paise
  gstPct: number
  tcsPct: number
  scrapInvoiceNo: string
  invoiceDate: ISODate
  status?: ScrapStatus
}

function validateScrap(s: RootState, input: ScrapInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  if (!getById(s.masters.customers, input.customerId)) errors.push('Customer is required')
  if (!input.scrapInvoiceNo.trim()) errors.push('Invoice no. is required')
  if (!(input.weightGrams > 0)) errors.push('Weight must be greater than 0')
  else if (input.weightGrams > 1e10) errors.push('Weight is implausibly large') // ~10,000 t guard vs fat-finger / 1.2E+9 paste
  if (!(input.ratePerKgPaise > 0)) errors.push('Rate per kg must be greater than 0')
  else if (input.ratePerKgPaise > 1e9) errors.push('Rate per kg is implausibly large')
  if (!input.invoiceDate) errors.push('Invoice date is required')
  if (input.periodFrom && input.periodTo && input.periodTo < input.periodFrom) {
    errors.push('Period "to" must be on or after period "from"')
  }
  const dup = values(s.scrap.scrapBills).some(
    (b) => b.id !== input.id && b.unitId === input.unitId && b.scrapInvoiceNo === input.scrapInvoiceNo.trim()
  )
  if (dup) errors.push(`Scrap invoice ${input.scrapInvoiceNo} already exists`)
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyScrap(draft: RootState, input: ScrapInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('scr')
  const existing = input.id ? getById(draft.scrap.scrapBills, input.id) : undefined
  const bill: ScrapBill = {
    id,
    unitId: input.unitId,
    customerId: input.customerId,
    periodFrom: input.periodFrom,
    periodTo: input.periodTo,
    weightGrams: input.weightGrams,
    ratePerKgPaise: input.ratePerKgPaise,
    gstPct: input.gstPct,
    tcsPct: input.tcsPct,
    scrapInvoiceNo: input.scrapInvoiceNo.trim(),
    invoiceDate: input.invoiceDate,
    // New bills start as an editable draft (a 'sent'/'paid' bill is a locked legal doc).
    status: input.status ?? existing?.status ?? 'draft',
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.scrap.scrapBills, bill)
  const m = computeScrap(bill.weightGrams, bill.ratePerKgPaise, bill.gstPct, bill.tcsPct)
  return {
    result: { id },
    cascade: [
      `Scrap ${bill.scrapInvoiceNo}: ${(bill.weightGrams / 1000).toLocaleString('en-IN')} kg`,
      `TCS ${formatINRSymbol(m.tcs)} · grand ${formatINRSymbol(m.grand)}`,
    ],
    summary: `${existing ? 'Updated' : 'Saved'} scrap bill ${bill.scrapInvoiceNo} (${formatINRSymbol(m.grand)})`,
    refs: [{ type: 'scrapBill', id }],
    unitId: bill.unitId,
  }
}

const scrapCreate: Command<ScrapInput, { id: Id }> = { name: 'saveScrapBill', module: 'scrap', action: 'create', validate: validateScrap, apply: applyScrap }
const scrapEdit: Command<ScrapInput, { id: Id }> = { name: 'saveScrapBill', module: 'scrap', action: 'edit', validate: validateScrap, apply: applyScrap }
export function runSaveScrapBill(input: ScrapInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? scrapEdit : scrapCreate, input)
}

const scrapDeleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteScrapBill',
  module: 'scrap',
  action: 'delete',
  validate(s, input) {
    const b = getById(s.scrap.scrapBills, input.id)
    if (!b) return { ok: false, errors: ['Scrap bill not found'] }
    if (!writableUnitIds(s).has(b.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const b = getById(draft.scrap.scrapBills, input.id) as ScrapBill
    removeEntity(draft.scrap.scrapBills, input.id)
    return {
      result: { id: input.id },
      cascade: [`Scrap bill ${b.scrapInvoiceNo} deleted`],
      summary: `Deleted scrap bill ${b.scrapInvoiceNo}`,
      refs: [{ type: 'scrapBill', id: input.id }],
      unitId: b.unitId,
    }
  },
}
export function runDeleteScrapBill(id: Id): CommandResult<{ id: Id }> {
  return runCommand(scrapDeleteCmd, { id })
}

// ── rejection advice ─────────────────────────────────────────────────────────
export interface RejectionInput {
  id?: Id
  unitId: Id
  customerId: Id
  partId: Id
  sourceInwardId: Id
  rejDcNo: string
  rejDate: ISODate
  mrQty: number
  frQty: number
  weightBasis: RejectionWeightBasis
  /** Optional override; defaults to the part's finish/scrap weight per the basis. */
  weightPerRingMg?: number
}

function basisWeightMg(s: RootState, partId: Id, basis: RejectionWeightBasis): number {
  const part = getById(s.masters.parts, partId)
  if (!part) return 0
  return basis === 'scrap' ? part.scrapWtMg : part.finishWtMg
}

function validateRejection(s: RootState, input: RejectionInput): { ok: true } | { ok: false; errors: string[] } {
  const errors: string[] = []
  if (!writableUnitIds(s).has(input.unitId)) errors.push("You don't have access to that unit")
  if (!getById(s.masters.customers, input.customerId)) errors.push('Customer is required')
  if (!getById(s.masters.parts, input.partId)) errors.push('Part is required')
  const inward = getById(s.inventory.inwards, input.sourceInwardId)
  if (!inward) errors.push('Source challan is required')
  if (!input.rejDcNo.trim()) errors.push('Rejection DC no. is required')
  if (input.mrQty < 0 || input.frQty < 0) errors.push('Quantities cannot be negative')
  if (!(input.mrQty + input.frQty > 0)) errors.push('Enter a rejected quantity (MR or FR)')
  // A rejection DC no. is a printed legal document — unique per unit (like inward/scrap).
  const dupDc = values(s.rejection.rejectionAdvices).some(
    (a) => a.id !== input.id && a.unitId === input.unitId && a.rejDcNo === input.rejDcNo.trim()
  )
  if (dupDc) errors.push(`Rejection DC ${input.rejDcNo} already exists`)
  // Can't return more rings than the source challan received (sum across all its advices).
  if (inward) {
    const others = values(s.rejection.rejectionAdvices)
      .filter((a) => a.id !== input.id && a.sourceInwardId === input.sourceInwardId)
      .reduce((sum, a) => sum + a.mrQty + a.frQty, 0)
    if (input.mrQty + input.frQty + others > inward.receivedQty) {
      errors.push(`Rejected qty exceeds the challan's received qty (${inward.receivedQty})`)
    }
  }
  return errors.length ? { ok: false, errors } : { ok: true }
}

function applyRejection(draft: RootState, input: RejectionInput, ctx: CommandContext): ApplyOut<{ id: Id }> {
  const id = input.id ?? ctx.newId('rej')
  const existing = input.id ? getById(draft.rejection.rejectionAdvices, input.id) : undefined
  const perRing = input.weightPerRingMg ?? basisWeightMg(draft, input.partId, input.weightBasis)
  const totalRej = input.mrQty + input.frQty
  const totalWeightGrams = Math.round((totalRej * perRing) / 1000)
  const advice: RejectionAdvice = {
    id,
    unitId: input.unitId,
    customerId: input.customerId,
    partId: input.partId,
    sourceInwardId: input.sourceInwardId,
    rejDcNo: input.rejDcNo.trim(),
    rejDate: input.rejDate,
    mrQty: input.mrQty,
    frQty: input.frQty,
    weightBasis: input.weightBasis,
    weightPerRingMg: perRing,
    totalWeightGrams,
    createdBy: existing?.createdBy ?? ctx.actor.id,
    createdAt: existing?.createdAt ?? ctx.now,
  }
  putEntity(draft.rejection.rejectionAdvices, advice)
  return {
    result: { id },
    cascade: [
      `Rejection DC ${advice.rejDcNo}: ${totalRej.toLocaleString('en-IN')} pcs`,
      `${(totalWeightGrams / 1000).toLocaleString('en-IN')} kg (${advice.weightBasis} weight)`,
    ],
    summary: `${existing ? 'Updated' : 'Saved'} rejection advice ${advice.rejDcNo}`,
    refs: [{ type: 'rejectionAdvice', id }],
    unitId: advice.unitId,
  }
}

const rejCreate: Command<RejectionInput, { id: Id }> = { name: 'saveRejectionAdvice', module: 'rejection', action: 'create', validate: validateRejection, apply: applyRejection }
const rejEdit: Command<RejectionInput, { id: Id }> = { name: 'saveRejectionAdvice', module: 'rejection', action: 'edit', validate: validateRejection, apply: applyRejection }
export function runSaveRejectionAdvice(input: RejectionInput): CommandResult<{ id: Id }> {
  return runCommand(input.id ? rejEdit : rejCreate, input)
}

const rejDeleteCmd: Command<{ id: Id }, { id: Id }> = {
  name: 'deleteRejectionAdvice',
  module: 'rejection',
  action: 'delete',
  validate(s, input) {
    const a = getById(s.rejection.rejectionAdvices, input.id)
    if (!a) return { ok: false, errors: ['Rejection advice not found'] }
    if (!writableUnitIds(s).has(a.unitId)) return { ok: false, errors: ["You don't have access to that unit"] }
    return { ok: true }
  },
  apply(draft, input) {
    const a = getById(draft.rejection.rejectionAdvices, input.id) as RejectionAdvice
    removeEntity(draft.rejection.rejectionAdvices, input.id)
    return {
      result: { id: input.id },
      cascade: [`Rejection DC ${a.rejDcNo} deleted`],
      summary: `Deleted rejection advice ${a.rejDcNo}`,
      refs: [{ type: 'rejectionAdvice', id: input.id }],
      unitId: a.unitId,
    }
  },
}
export function runDeleteRejectionAdvice(id: Id): CommandResult<{ id: Id }> {
  return runCommand(rejDeleteCmd, { id })
}
