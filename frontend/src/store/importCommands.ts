/**
 * importCommands.ts (plan P3) — ingest the real MIO register as ONE atomic,
 * undoable transaction: insert every inward + its dispatch children + the
 * draft invoice per (unit, Bill No). Store-aware validation (unknown part,
 * duplicate challan, cumulative over-dispatch) lives here; the pure parse +
 * grouping is in lib/mioImport.ts.
 */
import type { Dispatch, Id, Inward, Invoice } from '@/types/domain'
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
}

export interface ImportSummary {
  inwards: number
  dispatches: number
  invoices: number
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

/**
 * Store-aware issues for the wizard preview AND the command gate. Returns the
 * full list (the wizard renders it); `runImportMio` blocks if any are errors.
 */
export function previewImportIssues(s: RootState, input: ImportInput): ImportIssue[] {
  const issues: ImportIssue[] = []
  if (!writableUnitIds(s).has(input.unitId)) {
    issues.push({ level: 'error', row: 0, message: 'You do not have write access to that unit' })
  }
  const seen = new Set<string>()
  for (const inw of input.inwards) {
    const sheetRow = inw.rowIndex + 2
    const partId = resolvePartId(s, input.unitId, inw.partNo)
    if (!partId) {
      issues.push({ level: 'error', row: sheetRow, message: `Unknown part "${inw.partNo}" in this unit — add it in Masters first` })
    }
    if (!inw.challanNo) issues.push({ level: 'error', row: sheetRow, message: 'Missing challan no' })
    if (!inw.challanDate) issues.push({ level: 'error', row: sheetRow, message: 'Missing / invalid challan date' })
    const key = `${inw.partNo.trim().toLowerCase()}::${inw.challanNo}`
    if (seen.has(key)) issues.push({ level: 'error', row: sheetRow, message: `Duplicate challan ${inw.challanNo} for ${inw.partNo} within the file` })
    seen.add(key)
    if (partId) {
      const dupStore = values(s.inventory.inwards).some(
        (i) => i.unitId === input.unitId && i.partId === partId && i.challanNo === inw.challanNo
      )
      if (dupStore) issues.push({ level: 'error', row: sheetRow, message: `Challan ${inw.challanNo} already exists for ${inw.partNo}` })
    }
    if (!(inw.receivedQty > 0)) {
      issues.push({ level: 'error', row: sheetRow, message: `Challan ${inw.challanNo}: received qty must be greater than 0` })
    }
    const consumed = inw.dispatches.reduce((a, d) => a + d.okQty + d.mrQty + d.mfQty, 0)
    if (consumed > inw.receivedQty) {
      issues.push({ level: 'error', row: sheetRow, message: `Challan ${inw.challanNo}: dispatched ${consumed.toLocaleString('en-IN')} exceeds received ${inw.receivedQty.toLocaleString('en-IN')}` })
    }
    for (const d of inw.dispatches) {
      // The manual dispatch path rejects negatives; the import path bypasses it, so a
      // negative cell (parsed straight through) would otherwise reach stock unchecked.
      if (d.okQty < 0 || d.mrQty < 0 || d.mfQty < 0) {
        issues.push({ level: 'error', row: d.rowIndex + 2, message: `Negative quantity on ${inw.challanNo} (bill ${d.billNo ?? '—'}) — check the sheet` })
      }
      if (d.kind === 'billed' && (d.ratePaise == null || d.ratePaise <= 0)) {
        issues.push({ level: 'error', row: d.rowIndex + 2, message: `Billed line ${d.billNo ?? ''} on ${inw.challanNo} needs a rate` })
      }
    }
  }
  return issues
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
  let nDsp = 0
  const invByBill = new Map<string, Invoice>()

  for (const pinw of input.inwards) {
    const partId = resolvePartId(draft, input.unitId, pinw.partNo)!
    const part = getById(draft.masters.parts, partId)
    const inwId = ctx.newId('inw')
    const inward: Inward = {
      id: inwId,
      unitId: input.unitId,
      partId,
      challanNo: pinw.challanNo,
      challanDate: pinw.challanDate,
      poNo: pinw.poNo,
      batchHeatNo: pinw.batchHeatNo,
      rmRatePaise: pinw.rmRatePaise,
      receivedQty: pinw.receivedQty,
      createdBy: ctx.actor.id,
      createdAt: ctx.now,
    }
    putEntity(draft.inventory.inwards, inward)
    nInw += 1

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
        custInvoiceNo: d.custInvoiceNo,
        custInvoiceDate: d.custInvoiceDate,
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
  const result: ImportSummary = { inwards: nInw, dispatches: nDsp, invoices: invByBill.size }
  return {
    result,
    cascade: [
      `${nInw.toLocaleString('en-IN')} challans, ${nDsp.toLocaleString('en-IN')} dispatches imported`,
      `${invByBill.size.toLocaleString('en-IN')} draft bill${invByBill.size === 1 ? '' : 's'} created`,
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
