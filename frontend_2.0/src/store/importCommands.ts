/**
 * importCommands.ts (plan P3) — ingest the real MIO register as ONE atomic,
 * undoable transaction: insert every inward + its dispatch children + the
 * draft invoice per (unit, Bill No). Store-aware validation (unknown part,
 * duplicate challan, cumulative over-dispatch) lives here; the pure parse +
 * grouping is in lib/mioImport.ts.
 */
import type { Dispatch, Id, Inward, Invoice, Part } from '@/types/domain'
import { fyOf } from '@/lib/fy'
import type { ParsedInward, ImportIssue } from '@/lib/mioImport'
import { getById, putEntity, values } from './normalized'
import { writableUnitIds } from './scope'
import type { RootState } from './state'
import { runCommand, type ApplyOut, type Command, type CommandContext } from './commandBus'
import type { CommandResult } from './commands'

export interface ImportInput {
  unitId: Id
  inwards: ParsedInward[]
  /** When set, a sheet part-no that isn't in the unit is CREATED (sensible
   *  defaults) instead of blocking the import — for raw client workbooks whose
   *  parts aren't set up yet. */
  autoCreateParts?: boolean
}

export interface ImportSummary {
  inwards: number
  reusedInwards: number
  dispatches: number
  invoices: number
  partsCreated: number
}

function existingInwardFor(s: RootState, unitId: Id, partId: Id, challanNo: string): Inward | undefined {
  const challan = challanNo.trim().toLowerCase()
  return values(s.inventory.inwards).find(
    (i) => i.unitId === unitId && i.partId === partId && i.challanNo.trim().toLowerCase() === challan
  )
}

function usedOutwardKeys(s: RootState, unitId: Id): Set<string> {
  const inwardIds = new Set(values(s.inventory.inwards).filter((i) => i.unitId === unitId).map((i) => i.id))
  return new Set(values(s.inventory.dispatches)
    .filter((d) => inwardIds.has(d.inwardId) && d.billNo?.trim())
    .map((d) => `${d.inwardId}::${d.billNo!.trim().toLowerCase()}`))
}

function outwardParentKey(s: RootState, unitId: Id, inw: ParsedInward): string {
  const partId = resolvePartId(s, unitId, inw.partNo)
  return (partId && existingInwardFor(s, unitId, partId, inw.challanNo)?.id)
    ?? `${partId ?? inw.partNo.trim().toLowerCase()}::${inw.challanNo.trim().toLowerCase()}`
}

function parseSeq(billNo: string): number {
  const n = parseInt(billNo, 10)
  return Number.isNaN(n) ? 0 : n
}

/** Match a sheet part-no to a Part within the target unit (case-insensitive). */
function resolvePartId(s: RootState, unitId: Id, partNo: string): Id | undefined {
  const norm = partNo.trim().toLowerCase()
  return values(s.masters.parts).find((p) => p.unitId === unitId && p.partNo.trim().toLowerCase() === norm)?.id
}

/** Create a minimal Part for an auto-imported part-no (bearing-ring defaults). */
function createImportedPart(draft: RootState, ctx: CommandContext, unitId: Id, partNo: string): Id {
  const id = ctx.newId('part')
  const clean = partNo.trim()
  const part: Part = {
    id,
    partNo: clean,
    materialCode: clean.toUpperCase().replace(/\s+/g, '-'),
    description: 'Imported from MIO workbook',
    unitId,
    uom: 'NOS',
    hsnSac: '84829900',
    gstPct: 12,
    finishWtMg: 0,
    scrapWtMg: 0,
    avgQtyPerBox: 50,
    active: true,
  }
  putEntity(draft.masters.parts, part)
  return id
}

/** Per-inward issues (part/date/qty/over-dispatch/rate). Within-file duplicate is
 *  cross-row, so it's handled by the caller. */
function inwardIssues(s: RootState, unitId: Id, inw: ParsedInward, auto: boolean): ImportIssue[] {
  const issues: ImportIssue[] = []
  const sheetRow = inw.rowIndex + 2
  const partId = resolvePartId(s, unitId, inw.partNo)
  if (!partId) {
    if (auto) issues.push({ level: 'warn', row: sheetRow, message: `Part "${inw.partNo}" will be created in the selected unit` })
    else issues.push({ level: 'error', row: sheetRow, message: `Unknown part "${inw.partNo}" — add it in Part Master first` })
  }
  if (!inw.challanNo) issues.push({ level: 'error', row: sheetRow, message: 'Missing challan no' })
  const existing = partId ? existingInwardFor(s, unitId, partId, inw.challanNo) : undefined
  if (!existing && !inw.challanDate) issues.push({ level: 'error', row: sheetRow, message: 'Missing / invalid challan date' })
  if (existing) issues.push({ level: 'warn', row: sheetRow, message: `Existing inward challan ${inw.challanNo} will be reused for new outward D/C records` })
  if (!existing && !(inw.receivedQty > 0)) {
    issues.push({ level: 'error', row: sheetRow, message: `Challan ${inw.challanNo}: received qty must be greater than 0` })
  }
  const consumed = inw.dispatches.reduce((a, d) => a + d.okQty + d.mrQty + d.mfQty, 0)
  const alreadyDispatched = existing
    ? values(s.inventory.dispatches).filter((d) => d.inwardId === existing.id).reduce((a, d) => a + d.okQty + d.mcRejQty + d.mfQty, 0)
    : 0
  const available = existing ? existing.receivedQty - alreadyDispatched : inw.receivedQty
  if (consumed > available) {
    issues.push({ level: 'error', row: sheetRow, message: `Challan ${inw.challanNo}: new outward quantity ${consumed.toLocaleString('en-IN')} exceeds available ${available.toLocaleString('en-IN')}` })
  }
  for (const d of inw.dispatches) {
    if (d.okQty < 0 || d.mrQty < 0 || d.mfQty < 0) {
      issues.push({ level: 'error', row: d.rowIndex + 2, message: `Negative quantity on ${inw.challanNo} (bill ${d.billNo ?? '—'}) — check the sheet` })
    }
    if (d.kind === 'billed' && (d.ratePaise == null || d.ratePaise <= 0)) {
      issues.push({ level: 'error', row: d.rowIndex + 2, message: `Billed line ${d.billNo ?? ''} on ${inw.challanNo} needs a rate` })
    }
  }
  return issues
}

/**
 * Store-aware issues for the wizard preview AND the command gate. Returns the
 * full list (the wizard renders it); `runImportMio` blocks if any are errors
 * (unless `skipInvalid` is set, which imports the valid challans only).
 */
export function previewImportIssues(s: RootState, input: ImportInput): ImportIssue[] {
  const issues: ImportIssue[] = []
  if (!writableUnitIds(s).has(input.unitId)) {
    issues.push({ level: 'error', row: 0, message: 'You do not have write access to that unit' })
  }
  const auto = input.autoCreateParts ?? false
  const seen = new Set<string>()
  const usedOutward = usedOutwardKeys(s, input.unitId)
  for (const inw of input.inwards) {
    const key = `${inw.partNo.trim().toLowerCase()}::${inw.challanNo}`
    if (seen.has(key)) issues.push({ level: 'error', row: inw.rowIndex + 2, message: `Duplicate challan ${inw.challanNo} for ${inw.partNo} within the file` })
    seen.add(key)
    const parentKey = outwardParentKey(s, input.unitId, inw)
    const newDispatches: ParsedInward['dispatches'] = []
    for (const d of inw.dispatches) {
      const dc = d.billNo?.trim()
      if (!dc) issues.push({ level: 'error', row: d.rowIndex + 2, message: `Outward record on ${inw.challanNo} needs a unique Our D/C No.` })
      else if (usedOutward.has(`${parentKey}::${dc.toLowerCase()}`)) issues.push({ level: 'error', row: d.rowIndex + 2, message: `Outward D/C ${dc} already exists for challan ${inw.challanNo} — skipped` })
      else {
        usedOutward.add(`${parentKey}::${dc.toLowerCase()}`)
        newDispatches.push(d)
      }
    }
    issues.push(...inwardIssues(s, input.unitId, { ...inw, dispatches: newDispatches }, auto))
  }
  return issues
}

/** Split the parsed inwards into importable vs skip-with-reasons (used when the
 *  wizard's "skip invalid rows" is on — real workbooks carry footer/total junk). */
export function partitionInwards(s: RootState, input: ImportInput): {
  valid: ParsedInward[]
  skipped: { inward: ParsedInward; reasons: string[] }[]
} {
  const auto = input.autoCreateParts ?? false
  const seen = new Set<string>()
  const valid: ParsedInward[] = []
  const skipped: { inward: ParsedInward; reasons: string[] }[] = []
  const usedOutward = usedOutwardKeys(s, input.unitId)
  for (const inw of input.inwards) {
    const key = `${inw.partNo.trim().toLowerCase()}::${inw.challanNo}`
    const parentKey = outwardParentKey(s, input.unitId, inw)
    const newDispatches = inw.dispatches.filter((d) => {
      const dc = d.billNo?.trim().toLowerCase()
      const key = `${parentKey}::${dc}`
      if (!dc || usedOutward.has(key)) return false
      usedOutward.add(key)
      return true
    })
    const candidate = { ...inw, dispatches: newDispatches }
    const reasons = inwardIssues(s, input.unitId, candidate, auto).filter((i) => i.level === 'error').map((i) => i.message)
    if (seen.has(key)) reasons.push(`Duplicate challan ${inw.challanNo} within the file`)
    seen.add(key)
    const partId = resolvePartId(s, input.unitId, inw.partNo)
    if (partId && existingInwardFor(s, input.unitId, partId, inw.challanNo) && newDispatches.length === 0) {
      reasons.push(`No new outward D/C records for existing challan ${inw.challanNo}`)
    }
    if (reasons.length) skipped.push({ inward: inw, reasons })
    else valid.push(candidate)
  }
  return { valid, skipped }
}

function validateImport(s: RootState, input: ImportInput): { ok: true } | { ok: false; errors: string[] } {
  if (input.inwards.length === 0) return { ok: false, errors: ['Nothing to import'] }
  const errors = previewImportIssues(s, input)
    .filter((i) => i.level === 'error')
    .map((i) => (i.row ? `Row ${i.row}: ${i.message}` : i.message))
  // Cap the surfaced list so a malformed sheet can't build a megastring.
  return errors.length ? { ok: false, errors: errors.slice(0, 40) } : { ok: true }
}

function applyImport(draft: RootState, input: ImportInput, ctx: CommandContext): ApplyOut<ImportSummary> {
  let nInw = 0
  let nReused = 0
  let nDsp = 0
  const invByBill = new Map<string, Invoice>()
  const partCache = new Map<string, Id>() // norm part-no → id (created this run)

  for (const pinw of input.inwards) {
    const norm = pinw.partNo.trim().toLowerCase()
    let partId = resolvePartId(draft, input.unitId, pinw.partNo) ?? partCache.get(norm)
    if (!partId) {
      partId = createImportedPart(draft, ctx, input.unitId, pinw.partNo)
      partCache.set(norm, partId)
    }
    const part = getById(draft.masters.parts, partId)
    const existing = existingInwardFor(draft, input.unitId, partId, pinw.challanNo)
    const inwId = existing?.id ?? ctx.newId('inw')
    if (existing) nReused += 1
    else {
      const inward: Inward = {
        id: inwId, unitId: input.unitId, partId, challanNo: pinw.challanNo,
        challanDate: pinw.challanDate, poNo: pinw.poNo, batchHeatNo: pinw.batchHeatNo,
        rmRatePaise: pinw.rmRatePaise, receivedQty: pinw.receivedQty,
        createdBy: ctx.actor.id, createdAt: ctx.now,
      }
      putEntity(draft.inventory.inwards, inward)
      nInw += 1
    }

    for (const d of pinw.dispatches) {
      const dspId = ctx.newId('dsp')
      const billed = d.kind === 'billed'
      const dispatch: Dispatch = {
        id: dspId,
        inwardId: inwId,
        kind: d.kind,
        okQty: d.okQty,
        mcRejQty: d.mrQty,
        mfQty: d.mfQty,
        billNo: d.billNo,
        billDate: d.billDate,
        dispatchDate: d.dispatchDate,
        rateSnapshotPaise: billed ? d.ratePaise : undefined,
        gstPctSnapshot: billed ? part?.gstPct : undefined,
        createdBy: ctx.actor.id,
        createdAt: ctx.now,
      }
      putEntity(draft.inventory.dispatches, dispatch)
      nDsp += 1

      if (billed && d.billNo) {
        let inv = invByBill.get(d.billNo)
        if (!inv) {
          inv = values(draft.billing.invoices).find(
            (v) => v.unitId === input.unitId && v.billNo === d.billNo && v.lifecycle === 'draft'
          )
          if (!inv) {
            const date = d.billDate ?? d.dispatchDate ?? pinw.challanDate ?? ctx.today
            inv = {
              id: ctx.newId('inv'),
              unitId: input.unitId,
              issuerKind: 'unit',
              issuerId: input.unitId,
              billNo: d.billNo,
              fy: fyOf(date),
              seq: parseSeq(d.billNo),
              invoiceDate: date,
              dispatchIds: [],
              lifecycle: 'draft',
              createdBy: ctx.actor.id,
              createdAt: ctx.now,
            }
            putEntity(draft.billing.invoices, inv)
          }
          invByBill.set(d.billNo, inv)
        }
        if (!inv.dispatchIds.includes(dspId)) inv.dispatchIds.push(dspId)
      }
    }
  }

  const unitName = getById(draft.masters.units, input.unitId)?.name ?? 'unit'
  const result: ImportSummary = { inwards: nInw, reusedInwards: nReused, dispatches: nDsp, invoices: invByBill.size, partsCreated: partCache.size }
  return {
    result,
    cascade: [
      `${nInw.toLocaleString('en-IN')} challans, ${nDsp.toLocaleString('en-IN')} dispatches imported`,
      ...(nReused ? [`${nReused.toLocaleString('en-IN')} existing inward challans reused`] : []),
      `${invByBill.size.toLocaleString('en-IN')} draft bill${invByBill.size === 1 ? '' : 's'} created`,
      ...(partCache.size ? [`${partCache.size} new part${partCache.size === 1 ? '' : 's'} created`] : []),
    ],
    summary: `Imported ${nInw} challans / ${nDsp} dispatches into ${unitName}`,
    refs: [],
    unitId: input.unitId,
  }
}

const importCmd: Command<ImportInput, ImportSummary> = {
  name: 'importMioWorkbook',
  module: 'import',
  action: 'create',
  validate: validateImport,
  apply: applyImport,
}

export function runImportMio(input: ImportInput): CommandResult<ImportSummary> {
  return runCommand(importCmd, input)
}
