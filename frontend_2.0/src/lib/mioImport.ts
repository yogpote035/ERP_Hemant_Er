/**
 * mioImport.ts — PURE parse + grouping for the real MIO register workbook.
 *
 * The register is one flat sheet where a row with a Received QTY starts a new
 * inward challan (and usually carries its FIRST dispatch inline); a following
 * row with a BLANK Received QTY but a Bill No / qty is an ADDITIONAL dispatch on
 * the previous challan. This module turns raw cell rows + a column map into a
 * grouped `ParsedInward[]` plus structural issues. No store access here — the
 * store-aware checks (unknown part, duplicate challan, over-dispatch) live in
 * importCommands.ts so this stays unit-testable.
 */
import { toPaise, type Paise } from './money'
import { parseFlexibleDate } from './date'

/** Canonical fields we map the sheet's 26 columns onto. */
export const MIO_FIELDS = [
  { key: 'challanNo', label: 'Delivery Challan No', required: true },
  { key: 'challanDate', label: 'Challan Date', required: true },
  { key: 'partNo', label: 'Part No', required: true },
  { key: 'poNo', label: 'PO No', required: false },
  { key: 'batchHeatNo', label: 'Batch & Heat No', required: true },
  { key: 'rmRate', label: 'Rate / Unit (RM)', required: false },
  { key: 'receivedQty', label: 'Received QTY', required: true },
  { key: 'billNo', label: 'Bill No', required: false },
  { key: 'billDate', label: 'Bill Date', required: false },
  { key: 'okQty', label: 'OK / SKF Dispatch Qty', required: false },
  { key: 'mrQty', label: 'MR (machine reject)', required: false },
  { key: 'mfQty', label: 'MF (material fault)', required: false },
  { key: 'ratePerPc', label: 'Rate / Pc', required: false },
  { key: 'dispatchDate', label: 'Dispatch Date', required: false },
  { key: 'custInvoiceNo', label: 'Customer Invoice No', required: false },
  { key: 'custInvoiceDate', label: 'Customer Invoice Date', required: false },
] as const

export type MioFieldKey = (typeof MIO_FIELDS)[number]['key']
/** Canonical key -> column index in the sheet (-1 = unmapped). */
export type MioColumnMap = Record<MioFieldKey, number>

export interface ParsedDispatch {
  rowIndex: number
  billNo?: string
  billDate?: string
  okQty: number
  mrQty: number
  mfQty: number
  ratePaise?: Paise
  dispatchDate?: string
  custInvoiceNo?: string
  custInvoiceDate?: string
  kind: 'billed' | 'rejection'
}

export interface ParsedInward {
  rowIndex: number
  challanNo: string
  challanDate: string
  partNo: string
  poNo?: string
  batchHeatNo: string
  rmRatePaise?: Paise
  receivedQty: number
  dispatches: ParsedDispatch[]
}

export interface ImportIssue {
  level: 'error' | 'warn'
  /** 1-based sheet row (incl. the header) for display. */
  row: number
  message: string
}

export interface GroupResult {
  inwards: ParsedInward[]
  issues: ImportIssue[]
}

// ── cell coercion ─────────────────────────────────────────────────────────────
function cell(row: unknown[], idx: number): unknown {
  return idx >= 0 && idx < row.length ? row[idx] : undefined
}
function str(v: unknown): string {
  return v == null ? '' : String(v).trim()
}
/** Integer >= 0 from a cell, or null if blank/non-numeric. */
function intOrNull(v: unknown): number | null {
  const s = str(v)
  if (s === '') return null
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) ? Math.round(n) : null
}
function intOrZero(v: unknown): number {
  return intOrNull(v) ?? 0
}
/** Rupees cell -> integer paise, or undefined if blank/non-numeric. */
function moneyOrUndef(v: unknown): Paise | undefined {
  const s = str(v)
  if (s === '') return undefined
  const n = Number(s.replace(/,/g, ''))
  return Number.isFinite(n) && n > 0 ? toPaise(n) : undefined
}

/**
 * Find the row that looks like the MIO column header — real client workbooks put
 * a 2-3 row title band above it ("Material Inward & Outward", company name…).
 * Returns the first row carrying a challan-ish AND a part/received/bill-ish cell,
 * or 0 if none is obvious.
 */
export function detectHeaderRow(rows: unknown[][]): number {
  const headerish = (row: unknown[]): boolean => {
    const norm = row.map((c) => str(c).toLowerCase().replace(/[^a-z0-9]/g, ''))
    const has = (...needles: string[]) => norm.some((h) => h !== '' && needles.some((n) => h.includes(n)))
    return has('challan', 'dcno') && has('partno', 'received', 'billno')
  }
  const idx = rows.findIndex(headerish)
  return idx >= 0 ? idx : 0
}

/**
 * Auto-detect a column map from the header row by fuzzy keyword matching.
 * Unmatched fields are left at -1 for the user to map in the wizard.
 */
export function autoDetectColumns(header: unknown[]): MioColumnMap {
  const norm = header.map((h) => str(h).toLowerCase().replace(/[^a-z0-9]/g, ''))
  const find = (...needles: string[]): number =>
    norm.findIndex((h) => h !== '' && needles.some((n) => h.includes(n)))
  const map = {} as MioColumnMap
  map.challanNo = find('deliverychallan', 'challanno', 'dcno')
  map.challanDate = norm.findIndex((h) => h.includes('challandate'))
  map.partNo = find('partno', 'partnumber')
  map.poNo = find('pono', 'purchaseorder')
  map.batchHeatNo = find('batchheat', 'heatno', 'batch')
  map.rmRate = norm.findIndex((h) => h.includes('rateunit') || h.includes('rmrate'))
  map.receivedQty = find('receivedqty', 'recqty', 'received')
  map.billNo = find('billno')
  map.billDate = norm.findIndex((h) => h.includes('billdate'))
  map.okQty = find('skfdispatchqty', 'okqty', 'skfqty', 'dispatchqty')
  map.mrQty = norm.findIndex((h) => h === 'mr' || h.includes('machinerej') || h.startsWith('mr'))
  map.mfQty = norm.findIndex((h) => h === 'mf' || h.includes('materialfault') || h.startsWith('mf'))
  map.ratePerPc = norm.findIndex((h) => h.includes('ratepc') || h.includes('rateperpc'))
  map.dispatchDate = norm.findIndex((h) => h.includes('dispatchdate'))
  map.custInvoiceNo = norm.findIndex((h) => h.includes('invoiceno'))
  map.custInvoiceDate = norm.findIndex((h) => h.includes('invoicedate'))
  return map
}

/**
 * Group flat data rows (NOT including the header) into inward parents with
 * their dispatch children. A row with a Received QTY opens a new challan; a
 * blank-received row with bill/qty appends a dispatch to the open challan.
 */
export function groupMioRows(rows: unknown[][], map: MioColumnMap, headerRowIdx = 0): GroupResult {
  const inwards: ParsedInward[] = []
  const issues: ImportIssue[] = []
  let current: ParsedInward | null = null

  rows.forEach((row, i) => {
    const sheetRow = headerRowIdx + i + 2 // 1-based sheet row of this data row
    const challanNo = str(cell(row, map.challanNo))
    const recv = intOrNull(cell(row, map.receivedQty))
    const isAllBlank = row.every((c) => str(c) === '')
    if (isAllBlank) return

    const opensInward = challanNo !== '' && recv != null && recv > 0
    if (opensInward) {
      const challanDate = parseFlexibleDate(cell(row, map.challanDate))
      const partNo = str(cell(row, map.partNo))
      const batchHeatNo = str(cell(row, map.batchHeatNo))
      if (!partNo) issues.push({ level: 'error', row: sheetRow, message: 'Missing part no' })
      if (!challanDate) issues.push({ level: 'warn', row: sheetRow, message: `Unparseable challan date "${str(cell(row, map.challanDate))}"` })
      if (!batchHeatNo) issues.push({ level: 'warn', row: sheetRow, message: 'Missing batch / heat no' })
      current = {
        rowIndex: i,
        challanNo,
        challanDate: challanDate ?? '',
        partNo,
        poNo: str(cell(row, map.poNo)) || undefined,
        batchHeatNo,
        rmRatePaise: moneyOrUndef(cell(row, map.rmRate)),
        receivedQty: recv,
        dispatches: [],
      }
      inwards.push(current)
    } else if (challanNo !== '' && recv == null && (!current || challanNo !== current.challanNo)) {
      // A challan no with no received qty that ISN'T just the current challan repeated
      // on a multi-dispatch row (the normal case — those need no warning). Genuinely
      // ambiguous: a different challan with no spine row, so flag where it landed.
      issues.push({
        level: 'warn',
        row: sheetRow,
        message: `Challan ${challanNo} has no Received QTY — appended as a dispatch on ${current?.challanNo ?? '(no open challan)'}`,
      })
    }

    const billNo = str(cell(row, map.billNo))
    const ok = intOrZero(cell(row, map.okQty))
    const mr = intOrZero(cell(row, map.mrQty))
    const mf = intOrZero(cell(row, map.mfQty))
    const hasDispatch = billNo !== '' || ok > 0 || mr > 0 || mf > 0
    if (hasDispatch) {
      if (!current) {
        issues.push({ level: 'error', row: sheetRow, message: 'Dispatch row before any inward challan' })
        return
      }
      const billed = ok > 0
      const ratePaise = moneyOrUndef(cell(row, map.ratePerPc))
      if (billed && ratePaise == null) {
        issues.push({ level: 'warn', row: sheetRow, message: `Bill ${billNo || '(none)'} has OK qty but no rate` })
      }
      current.dispatches.push({
        rowIndex: i,
        billNo: billNo || undefined,
        billDate: parseFlexibleDate(cell(row, map.billDate)) ?? undefined,
        okQty: ok,
        mrQty: mr,
        mfQty: mf,
        ratePaise: billed ? ratePaise : undefined,
        dispatchDate: parseFlexibleDate(cell(row, map.dispatchDate)) ?? undefined,
        custInvoiceNo: str(cell(row, map.custInvoiceNo)) || undefined,
        custInvoiceDate: parseFlexibleDate(cell(row, map.custInvoiceDate)) ?? undefined,
        kind: billed ? 'billed' : 'rejection',
      })
    }
  })

  return { inwards, issues }
}

/** Quick roll-up for the preview header. */
export function summarize(inwards: ParsedInward[]): {
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
