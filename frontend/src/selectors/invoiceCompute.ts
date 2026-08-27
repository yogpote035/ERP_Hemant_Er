/**
 * invoiceCompute.ts (plan P4) — the WRITE-side derivation for the invoice
 * composer: build challan-wise line items from a draft's billed dispatches,
 * derive IGST vs CGST/SGST from the issuer↔consignee state codes, compute
 * round-off + grand, and the packing-box breakdown. `finalizeInvoice`
 * snapshots the result onto the invoice for legal immutability.
 */
import type { Id, Invoice, InvoiceTotals, PackingBox, TaxKind } from '@/types/domain'
import {
  addP,
  mulQty,
  pctOfPaise,
  roundToRupee,
  roundOffDelta,
  splitGst,
  type Paise,
} from '@/lib/money'
import { formatDMY } from '@/lib/date'
import { values, getById } from '@/store/normalized'
import type { RootState } from '@/store/state'
import { allowedUnitIds } from '@/store/scope'
import { invoicePaymentStatus, outstandingForInvoice, invoiceGrand, type PaymentStatus } from './billing'

const ZERO = 0 as Paise

/** Intra-state (same state code) → CGST+SGST; otherwise IGST. */
export function deriveTaxKind(issuerStateCode: string | undefined, custStateCode: string | undefined): TaxKind {
  return issuerStateCode && custStateCode && issuerStateCode === custStateCode ? 'cgst_sgst' : 'igst'
}

export interface InvoiceLine {
  dispatchId: Id
  challanNo: string
  partId: Id
  partNo: string
  hsnSac: string
  qty: number
  ratePaise: Paise
  gstPct: number
  amountPaise: Paise
}

/** Billed (OK-qty, rated) dispatch lines on an invoice, challan-wise. A non-draft
 *  invoice returns its FROZEN line snapshot so a later part/inward edit can't restate
 *  the printed line items. */
export function selectInvoiceLines(s: RootState, inv: Invoice): InvoiceLine[] {
  if (inv.lifecycle !== 'draft' && inv.lineSnapshot) return inv.lineSnapshot
  const lines: InvoiceLine[] = []
  for (const id of inv.dispatchIds) {
    const d = getById(s.inventory.dispatches, id)
    if (!d || d.kind !== 'billed' || d.okQty <= 0 || d.rateSnapshotPaise == null) continue
    const inward = getById(s.inventory.inwards, d.inwardId)
    const part = inward ? getById(s.masters.parts, inward.partId) : undefined
    lines.push({
      dispatchId: d.id,
      challanNo: inward?.challanNo ?? '—',
      partId: part?.id ?? '',
      partNo: part?.partNo ?? '—',
      hsnSac: part?.hsnSac ?? '',
      qty: d.okQty,
      ratePaise: d.rateSnapshotPaise,
      gstPct: d.gstPctSnapshot ?? part?.gstPct ?? 0,
      amountPaise: mulQty(d.rateSnapshotPaise, d.okQty),
    })
  }
  return lines
}

/** Aggregate packing boxes per part: ceil(qty / avgQtyPerBox). */
export function computePacking(s: RootState, lines: InvoiceLine[]): PackingBox[] {
  const byBoxSize = new Map<number, number>() // qtyPerBox -> boxes
  const qtyByPart = new Map<Id, number>()
  for (const l of lines) qtyByPart.set(l.partId, (qtyByPart.get(l.partId) ?? 0) + l.qty)
  for (const [partId, qty] of qtyByPart) {
    const per = getById(s.masters.parts, partId)?.avgQtyPerBox ?? 0
    if (per <= 0) continue
    const boxes = Math.ceil(qty / per)
    byBoxSize.set(per, (byBoxSize.get(per) ?? 0) + boxes)
  }
  return [...byBoxSize.entries()].map(([qtyPerBox, boxes]) => ({ qtyPerBox, boxes }))
}

export interface ComputedInvoice {
  lines: InvoiceLine[]
  totals: InvoiceTotals
  packing: PackingBox[]
  billedQty: number
}

/**
 * Compute live totals for a draft (or recompute for any invoice). Tax split is
 * driven by `taxKind`; the grand total is identical either way, so the draft
 * list can compute a grand even before a consignee is chosen (pass 'igst').
 */
export function computeInvoice(s: RootState, inv: Invoice, taxKind: TaxKind): ComputedInvoice {
  const lines = selectInvoiceLines(s, inv)
  let assessable = ZERO
  let totalGst = ZERO
  let billedQty = 0
  for (const l of lines) {
    assessable = addP(assessable, l.amountPaise)
    totalGst = addP(totalGst, pctOfPaise(l.amountPaise, l.gstPct))
    billedQty += l.qty
  }
  const split = splitGst(totalGst, taxKind === 'igst')
  const preRound = addP(assessable, totalGst)
  const grand = roundToRupee(preRound)
  const roundOff = roundOffDelta(preRound)
  const totals: InvoiceTotals = {
    assessable,
    cgst: split.cgst,
    sgst: split.sgst,
    igst: split.igst,
    roundOff,
    grand,
  }
  return { lines, totals, packing: computePacking(s, lines), billedQty }
}

export interface InvoiceRow {
  invoice: Invoice
  customerName: string
  status: PaymentStatus
  /** Snapshot grand for sent; live computed grand for drafts. */
  grand: Paise
  outstanding: Paise
  lineCount: number
}

export interface InvoicePdfModel {
  invoiceNo: string
  invoiceDate: string
  dueDate?: string
  taxKind: TaxKind
  issuerName: string
  issuerGstin: string
  issuerState: string
  issuerAddress: string[]
  custName: string
  custGstin: string
  custState: string
  custAddress: string[]
  lines: InvoiceLine[]
  totals: InvoiceTotals
  packing: PackingBox[]
}

/** Flatten everything the invoice PDF needs into plain data (no store access in the PDF module). */
export function selectInvoicePdfModel(s: RootState, invoiceId: Id): InvoicePdfModel | null {
  const inv = getById(s.billing.invoices, invoiceId)
  if (!inv) return null
  const unit = getById(s.masters.units, inv.unitId)
  const cust = getById(s.masters.customers, inv.customerId)
  const issuerVendor = inv.issuerKind === 'supplier' ? getById(s.masters.vendors, inv.issuerId) : undefined
  const taxKind: TaxKind = inv.taxKind ?? deriveTaxKind(unit?.stateCode, cust?.stateCode)
  const computed = computeInvoice(s, inv, taxKind)
  const totals = inv.totals ?? computed.totals
  const packing = inv.packing ?? computed.packing
  // Prefer the frozen identity for a non-draft (issued) invoice; fall back to live masters
  // for drafts and legacy invoices that predate the snapshot.
  const ps = inv.partySnapshot
  return {
    invoiceNo: inv.billNo,
    invoiceDate: formatDMY(inv.invoiceDate),
    dueDate: inv.dueDate ? formatDMY(inv.dueDate) : undefined,
    taxKind,
    issuerName: ps?.issuerName ?? issuerVendor?.name ?? unit?.name ?? '',
    issuerGstin: ps?.issuerGstin ?? issuerVendor?.gstin ?? unit?.gstin ?? '',
    issuerState: ps?.issuerStateCode ?? (issuerVendor?.stateCode ?? unit?.stateCode) ?? '',
    issuerAddress: ps?.issuerAddress ?? issuerVendor?.addressLines ?? unit?.addressLines ?? [],
    custName: ps?.custName ?? cust?.name ?? '—',
    custGstin: ps?.custGstin ?? cust?.gstin ?? '',
    custState: ps?.custStateCode ?? cust?.stateCode ?? '',
    custAddress: ps?.custAddress ?? cust?.addressLines ?? [],
    lines: computed.lines,
    totals,
    packing,
  }
}

/** Scoped invoice list for the Billing page. */
export function selectInvoiceRows(s: RootState): InvoiceRow[] {
  const allowed = allowedUnitIds(s)
  return values(s.billing.invoices)
    .filter((inv) => allowed.has(inv.unitId))
    .map((inv) => {
      const isDraft = inv.lifecycle === 'draft'
      const grand = isDraft ? computeInvoice(s, inv, 'igst').totals.grand : invoiceGrand(inv)
      return {
        invoice: inv,
        customerName: inv.partySnapshot?.custName || getById(s.masters.customers, inv.customerId)?.name || '— unassigned —',
        status: invoicePaymentStatus(s, inv),
        grand,
        outstanding: outstandingForInvoice(s, inv),
        lineCount: selectInvoiceLines(s, inv).length,
      }
    })
    .sort((a, b) => (b.invoice.invoiceDate ?? '').localeCompare(a.invoice.invoiceDate ?? ''))
}
