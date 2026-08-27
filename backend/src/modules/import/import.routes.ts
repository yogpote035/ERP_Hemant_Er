/**
 * Import module (phase 2) — ingest an already-parsed MIO register as ONE atomic
 * write: create any missing parts, then every inward challan + its dispatch
 * children + a DRAFT invoice per (unit, Bill No).
 *
 * Ported from the frontend:
 *   - store/importCommands.ts  (applyImport, partitionInwards, createImportedPart,
 *                               previewImportIssues / inwardIssues)
 *   - lib/mioImport.ts         (ParsedInward / ParsedDispatch / ImportIssue shapes)
 *
 * The server does NOT parse xlsx — it accepts the parsed `ParsedInward[]` rows as
 * JSON (the wizard does the parse/grouping client-side). Store-aware validation
 * (unknown part, duplicate challan, over-dispatch, rate) is ported faithfully.
 *
 * Session/scope (`writableUnitIds(s)`, `ctx.*`) is replaced by the route-layer
 * auth scope: `assertUnit(req, targetUnitId)` for the write, and `genId` /
 * `req.auth.user.id` / `nowISO()` / `todayISO()` for server-managed fields.
 * Money fields (rmRatePaise, ratePaise) are INTEGER PAISE.
 */
import { Router } from 'express'
import { z } from 'zod'
import { getDb, mutate, values, getById } from '../../db/repository.js'
import { putEntity } from '../../db/normalized.js'
import { asyncHandler } from '../../lib/http.js'
import { authenticate, requirePermission, assertUnit } from '../../auth/middleware.js'
import { genId, nowISO, todayISO } from '../../lib/id.js'
import { fyOf } from '../../lib/fy.js'
import type { RootState } from '../../db/state.js'
import type { Dispatch, Id, Inward, Invoice, Part } from '../../types/domain.js'
import type { Paise } from '../../lib/money.js'

// ── parsed-row shapes (mirror lib/mioImport.ts; rates already in paise) ───────────
interface ParsedDispatch {
  rowIndex: number
  billNo?: string
  billDate?: string
  okQty: number
  mrQty: number
  mfQty: number
  ratePaise?: number
  dispatchDate?: string
  custInvoiceNo?: string
  custInvoiceDate?: string
  kind: 'billed' | 'rejection'
}

interface ParsedInward {
  rowIndex: number
  challanNo: string
  challanDate: string
  partNo: string
  poNo?: string
  batchHeatNo: string
  rmRatePaise?: number
  receivedQty: number
  dispatches: ParsedDispatch[]
}

interface ImportIssue {
  level: 'error' | 'warn'
  /** 1-based sheet row (incl. the header) for display. */
  row: number
  message: string
}

interface ImportSummary {
  inwards: number
  dispatches: number
  invoices: number
  partsCreated: number
}

// ── request schemas ──────────────────────────────────────────────────────────────
const dispatchSchema = z.object({
  rowIndex: z.number().int().default(0),
  billNo: z.string().optional(),
  billDate: z.string().optional(),
  okQty: z.number().int().default(0),
  mrQty: z.number().int().default(0),
  mfQty: z.number().int().default(0),
  ratePaise: z.number().int().optional(),
  dispatchDate: z.string().optional(),
  custInvoiceNo: z.string().optional(),
  custInvoiceDate: z.string().optional(),
  kind: z.enum(['billed', 'rejection']),
})

const inwardSchema = z.object({
  rowIndex: z.number().int().default(0),
  challanNo: z.string().default(''),
  challanDate: z.string().default(''),
  partNo: z.string().default(''),
  poNo: z.string().optional(),
  batchHeatNo: z.string().default(''),
  rmRatePaise: z.number().int().optional(),
  receivedQty: z.number().int().default(0),
  dispatches: z.array(dispatchSchema).default([]),
})

const previewSchema = z.object({
  inwards: z.array(inwardSchema).default([]),
  autoCreateParts: z.boolean().optional(),
  targetUnitId: z.string().min(1, 'Target unit is required'),
})

const applySchema = previewSchema.extend({
  skipInvalid: z.boolean().optional(),
})

// ── ported helpers (importCommands.ts) ───────────────────────────────────────────
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
function createImportedPart(draft: RootState, unitId: Id, partNo: string): Id {
  const id = genId('part')
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
    if (auto) issues.push({ level: 'warn', row: sheetRow, message: `Part "${inw.partNo}" will be created in this unit` })
    else issues.push({ level: 'error', row: sheetRow, message: `Unknown part "${inw.partNo}" in this unit — add it in Masters first` })
  }
  if (!inw.challanNo) issues.push({ level: 'error', row: sheetRow, message: 'Missing challan no' })
  if (!inw.challanDate) issues.push({ level: 'error', row: sheetRow, message: 'Missing / invalid challan date' })
  if (partId) {
    const dupStore = values(s.inventory.inwards).some(
      (i) => i.unitId === unitId && i.partId === partId && i.challanNo === inw.challanNo
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
 * Store-aware issues for the wizard preview AND the apply gate. Returns the full
 * list (the wizard renders it); apply blocks if any are errors unless `skipInvalid`.
 * The frontend's `writableUnitIds` gate is replaced by the route-layer assertUnit.
 */
function previewImportIssues(s: RootState, unitId: Id, inwards: ParsedInward[], auto: boolean): ImportIssue[] {
  const issues: ImportIssue[] = []
  const seen = new Set<string>()
  for (const inw of inwards) {
    const key = `${inw.partNo.trim().toLowerCase()}::${inw.challanNo}`
    if (seen.has(key)) issues.push({ level: 'error', row: inw.rowIndex + 2, message: `Duplicate challan ${inw.challanNo} for ${inw.partNo} within the file` })
    seen.add(key)
    issues.push(...inwardIssues(s, unitId, inw, auto))
  }
  return issues
}

/** Split the parsed inwards into importable vs skip-with-reasons (used when
 *  `skipInvalid` is on — real workbooks carry footer/total junk). */
function partitionInwards(
  s: RootState,
  unitId: Id,
  inwards: ParsedInward[],
  auto: boolean
): { valid: ParsedInward[]; skipped: { inward: ParsedInward; reasons: string[] }[] } {
  const seen = new Set<string>()
  const valid: ParsedInward[] = []
  const skipped: { inward: ParsedInward; reasons: string[] }[] = []
  for (const inw of inwards) {
    const key = `${inw.partNo.trim().toLowerCase()}::${inw.challanNo}`
    const reasons = inwardIssues(s, unitId, inw, auto).filter((i) => i.level === 'error').map((i) => i.message)
    if (seen.has(key)) reasons.push(`Duplicate challan ${inw.challanNo} within the file`)
    seen.add(key)
    if (reasons.length) skipped.push({ inward: inw, reasons })
    else valid.push(inw)
  }
  return { valid, skipped }
}

/** Roll-up for the preview header (ported from mioImport.summarize). */
function summarize(inwards: ParsedInward[]): {
  inwardCount: number
  dispatchCount: number
  receivedQty: number
  billedQty: number
  rejectionQty: number
} {
  let dispatchCount = 0
  let receivedQty = 0
  let billedQty = 0
  let rejectionQty = 0
  for (const inw of inwards) {
    receivedQty += inw.receivedQty
    for (const d of inw.dispatches) {
      dispatchCount += 1
      billedQty += d.okQty
      rejectionQty += d.mrQty + d.mfQty
    }
  }
  return { inwardCount: inwards.length, dispatchCount, receivedQty, billedQty, rejectionQty }
}

/**
 * Ported applyImport: write missing parts + inwards + dispatches + draft invoices
 * into `draft`. Uses the route-layer actor/now/today instead of CommandContext.
 */
function applyImport(
  draft: RootState,
  unitId: Id,
  inwards: ParsedInward[],
  actorId: Id,
  now: string,
  today: string
): { result: ImportSummary; cascade: string[] } {
  let nInw = 0
  let nDsp = 0
  const invByBill = new Map<string, Invoice>()
  const partCache = new Map<string, Id>() // norm part-no → id (created this run)

  for (const pinw of inwards) {
    const norm = pinw.partNo.trim().toLowerCase()
    let partId = resolvePartId(draft, unitId, pinw.partNo) ?? partCache.get(norm)
    if (!partId) {
      partId = createImportedPart(draft, unitId, pinw.partNo)
      partCache.set(norm, partId)
    }
    const part = getById(draft.masters.parts, partId)
    const inwId = genId('inw')
    const inward: Inward = {
      id: inwId,
      unitId,
      partId,
      challanNo: pinw.challanNo,
      challanDate: pinw.challanDate,
      poNo: pinw.poNo,
      batchHeatNo: pinw.batchHeatNo,
      rmRatePaise: pinw.rmRatePaise as Paise | undefined,
      receivedQty: pinw.receivedQty,
      createdBy: actorId,
      createdAt: now,
    }
    putEntity(draft.inventory.inwards, inward)
    nInw += 1

    for (const d of pinw.dispatches) {
      const dspId = genId('dsp')
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
        rateSnapshotPaise: billed ? (d.ratePaise as Paise | undefined) : undefined,
        gstPctSnapshot: billed ? part?.gstPct : undefined,
        custInvoiceNo: d.custInvoiceNo,
        custInvoiceDate: d.custInvoiceDate,
        createdBy: actorId,
        createdAt: now,
      }
      putEntity(draft.inventory.dispatches, dispatch)
      nDsp += 1

      if (billed && d.billNo) {
        let inv = invByBill.get(d.billNo)
        if (!inv) {
          inv = values(draft.billing.invoices).find(
            (v) => v.unitId === unitId && v.billNo === d.billNo && v.lifecycle === 'draft'
          )
          if (!inv) {
            const date = d.billDate ?? d.dispatchDate ?? pinw.challanDate ?? today
            inv = {
              id: genId('inv'),
              unitId,
              issuerKind: 'unit',
              issuerId: unitId,
              billNo: d.billNo,
              fy: fyOf(date),
              seq: parseSeq(d.billNo),
              invoiceDate: date,
              dispatchIds: [],
              lifecycle: 'draft',
              createdBy: actorId,
              createdAt: now,
            }
            putEntity(draft.billing.invoices, inv)
          }
          invByBill.set(d.billNo, inv)
        }
        if (!inv.dispatchIds.includes(dspId)) inv.dispatchIds.push(dspId)
      }
    }
  }

  const result: ImportSummary = { inwards: nInw, dispatches: nDsp, invoices: invByBill.size, partsCreated: partCache.size }
  const cascade = [
    `${nInw.toLocaleString('en-IN')} challans, ${nDsp.toLocaleString('en-IN')} dispatches imported`,
    `${invByBill.size.toLocaleString('en-IN')} draft bill${invByBill.size === 1 ? '' : 's'} created`,
    ...(partCache.size ? [`${partCache.size} new part${partCache.size === 1 ? '' : 's'} created`] : []),
  ]
  return { result, cascade }
}

// ── router ───────────────────────────────────────────────────────────────────────
export const importRouter = Router()
importRouter.use(authenticate)

/**
 * POST /preview — store-aware dry run: returns the full issue list, a valid/skip
 * partition (for the "skip invalid" toggle), and a roll-up summary. No writes.
 */
importRouter.post(
  '/preview',
  requirePermission('import', 'view'),
  asyncHandler(async (req, res) => {
    const body = previewSchema.parse(req.body)
    assertUnit(req, body.targetUnitId)
    const auto = body.autoCreateParts ?? false
    const s = getDb()

    if (!getById(s.masters.units, body.targetUnitId)) {
      res.json({
        data: {
          issues: [{ level: 'error', row: 0, message: 'Unknown target unit' }] as ImportIssue[],
          summary: summarize([]),
          valid: 0,
          skipped: [],
          errorCount: 1,
          warnCount: 0,
        },
      })
      return
    }

    const inwards = body.inwards as ParsedInward[]
    const issues = previewImportIssues(s, body.targetUnitId, inwards, auto)
    const { valid, skipped } = partitionInwards(s, body.targetUnitId, inwards, auto)
    const errorCount = issues.filter((i) => i.level === 'error').length
    const warnCount = issues.filter((i) => i.level === 'warn').length

    res.json({
      data: {
        issues: issues.slice(0, 200),
        summary: summarize(inwards),
        valid: valid.length,
        skipped: skipped.map((s2) => ({ row: s2.inward.rowIndex + 2, challanNo: s2.inward.challanNo, partNo: s2.inward.partNo, reasons: s2.reasons })),
        errorCount,
        warnCount,
      },
    })
  })
)

/**
 * POST /apply — atomically create missing parts + inward/dispatch rows + draft
 * invoices. Blocks on any error issue unless `skipInvalid` is set (then it imports
 * only the valid challans). Returns the ImportSummary.
 */
importRouter.post(
  '/apply',
  requirePermission('import', 'create'),
  asyncHandler(async (req, res) => {
    const body = applySchema.parse(req.body)
    assertUnit(req, body.targetUnitId)
    const auto = body.autoCreateParts ?? false
    const skipInvalid = body.skipInvalid ?? false
    const s = getDb()

    if (!getById(s.masters.units, body.targetUnitId)) {
      res.status(400).json({ error: 'Unknown target unit' })
      return
    }

    const inwards = body.inwards as ParsedInward[]
    if (inwards.length === 0) {
      res.status(400).json({ error: 'Nothing to import', detail: ['Nothing to import'] })
      return
    }

    // Decide what to write: skip-invalid keeps the valid rows; otherwise all-or-nothing.
    let toImport: ParsedInward[]
    let skippedOut: { row: number; challanNo: string; reasons: string[] }[] = []
    if (skipInvalid) {
      const { valid, skipped } = partitionInwards(s, body.targetUnitId, inwards, auto)
      if (valid.length === 0) {
        res.status(400).json({ error: 'No valid challans to import', detail: skipped.flatMap((sk) => sk.reasons).slice(0, 40) })
        return
      }
      toImport = valid
      skippedOut = skipped.map((sk) => ({ row: sk.inward.rowIndex + 2, challanNo: sk.inward.challanNo, reasons: sk.reasons }))
    } else {
      const errors = previewImportIssues(s, body.targetUnitId, inwards, auto)
        .filter((i) => i.level === 'error')
        .map((i) => (i.row ? `Row ${i.row}: ${i.message}` : i.message))
      if (errors.length) {
        res.status(400).json({ error: 'Import rejected', detail: errors.slice(0, 40) })
        return
      }
      toImport = inwards
    }

    const actorId = req.auth!.user.id
    const now = nowISO()
    const today = todayISO()

    const { result, cascade } = await mutate((draft) =>
      applyImport(draft, body.targetUnitId, toImport, actorId, now, today)
    )

    const unitName = getById(getDb().masters.units, body.targetUnitId)?.name ?? 'unit'
    res.status(201).json({
      data: { ...result, skipped: skippedOut },
      cascade: [...cascade, `into ${unitName}`],
    })
  })
)
