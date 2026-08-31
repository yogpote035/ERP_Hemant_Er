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
  toWordsIndian,
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

/**
 * Packing-box breakdown per part, matching the printed invoice: `floor(qty / box)`
 * FULL boxes of the part's avg-qty-per-box, plus a single REMAINDER box for any
 * leftover (so 6000 @ 1050 → "5 × 1050" + "1 × 750", not "6 × 1050"). Each line is
 * labelled with the part's Packing Mode (e.g. GSP-2).
 */
export function computePacking(s: RootState, lines: InvoiceLine[]): PackingBox[] {
  const qtyByPart = new Map<Id, number>()
  for (const l of lines) qtyByPart.set(l.partId, (qtyByPart.get(l.partId) ?? 0) + l.qty)
  const out: PackingBox[] = []
  for (const [partId, qty] of qtyByPart) {
    const part = getById(s.masters.parts, partId)
    const per = part?.avgQtyPerBox ?? 0
    const mode = part?.packingMode
    if (per <= 0 || qty <= 0) continue
    const full = Math.floor(qty / per)
    const rem = qty % per
    if (full > 0) out.push({ boxes: full, qtyPerBox: per, mode })
    if (rem > 0) out.push({ boxes: 1, qtyPerBox: rem, mode })
  }
  return out
}

/** One packing line, e.g. "5 GSP-2 × 1050 = 5250". */
export function packingLineLabel(b: PackingBox): string {
  return `${b.boxes} ${b.mode ?? 'box'} × ${b.qtyPerBox.toLocaleString('en-IN')} = ${(b.boxes * b.qtyPerBox).toLocaleString('en-IN')}`
}

/** Grand totals across packing lines (single mode when all lines share it). */
export function packingTotal(packing: PackingBox[]): { boxes: number; qty: number; mode?: string } {
  const boxes = packing.reduce((a, b) => a + b.boxes, 0)
  const qty = packing.reduce((a, b) => a + b.boxes * b.qtyPerBox, 0)
  const modes = uniq(packing.map((b) => b.mode ?? '').filter((m) => m !== ''))
  return { boxes, qty, mode: modes.length === 1 ? modes[0] : undefined }
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
  // Tax kind keys off the ISSUER's state (a supplier-issued bill uses the vendor's
  // state, not the unit's) — must match selectInvoiceDocModel / finalize.
  const issuerState = issuerVendor?.stateCode ?? unit?.stateCode
  const taxKind: TaxKind = inv.taxKind ?? deriveTaxKind(issuerState, cust?.shippingStateCode || cust?.stateCode)
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

// ── Client-format invoice document (matches the real HEW GST Tax Invoice) ────
// A richer, read-side projection used by the on-screen preview + the PDF. Part
// lines group their dispatch challans (one part row → many Customer D.C rows),
// and each line carries the RM-traceability block (Die/Bin/Heat/RM supplier)
// pulled live from the source inward. Legal totals/party still come from the
// frozen snapshot via computeInvoice — this only adds the descriptive fields.

/** PAN is GSTIN chars 3–12 (2 state digits + 10-char PAN + 3). */
function panFromGstin(gstin?: string): string | undefined {
  return gstin && gstin.length >= 12 ? gstin.slice(2, 12) : undefined
}

const uniq = (xs: (string | undefined)[]): string[] =>
  [...new Set(xs.filter((x): x is string => !!x && x.trim() !== ''))]

export interface InvoiceDocDc {
  dcNo: string
  dcDate?: string
  qty: number
  ratePaise: Paise
  amountPaise: Paise
}

export interface InvoiceDocPartLine {
  partNo: string
  partType?: string
  dieNo?: string
  drgEdtNo?: string
  ircBinNo?: string
  heatNos: string[]
  rmSupplier?: string
  finishWeightG?: number
  packingMode?: string
  hsnSac: string
  gstPct: number
  dcs: InvoiceDocDc[]
  totalQty: number
  totalAmountPaise: Paise
}

export interface InvoiceDocModel {
  invoiceNo: string
  invoiceDate: string
  dueDate?: string
  taxKind: TaxKind
  /** Single headline GST% when all lines share one rate (else undefined). */
  uniformGstPct?: number
  // Supplier (issuer)
  issuerName: string
  issuerGstin: string
  issuerPan?: string
  issuerState: string
  issuerAddress: string[]
  issuerBank?: { name?: string; branch?: string; acc?: string; ifsc?: string }
  // Meta (fields with no store source are left blank, like the paper form)
  poJobworkNo?: string
  custTaxInvoiceNo?: string
  ewayBillNo?: string
  motorVehicleNo?: string
  transporter?: string
  dispatchedThrough?: string
  destination?: string
  termsOfPayment?: string
  remark?: string
  // Receiver (Bill to)
  custName: string
  custGstin: string
  custPan?: string
  custState: string
  custAddress: string[]
  // Consignee (shipped to) and customer commercial/contact details
  shipName: string
  shipGstin: string
  shipPan?: string
  shipState: string
  shipAddress: string[]
  contactPerson?: string
  contactPhone?: string
  contactEmail?: string
  freightTerms?: string
  transitInsuranceTerms?: string
  gstType: 'Inter State' | 'Intra State'
  sez: boolean
  // Body
  parts: InvoiceDocPartLine[]
  totals: InvoiceTotals
  packing: PackingBox[]
  amountWords: string
}

/** Build the full client-format invoice document for the preview + PDF. */
export function selectInvoiceDocModel(s: RootState, invoiceId: Id): InvoiceDocModel | null {
  const inv = getById(s.billing.invoices, invoiceId)
  if (!inv) return null
  const unit = getById(s.masters.units, inv.unitId)
  const cust = getById(s.masters.customers, inv.customerId)
  const issuerVendor = inv.issuerKind === 'supplier' ? getById(s.masters.vendors, inv.issuerId) : undefined
  const issuerState = issuerVendor?.stateCode ?? unit?.stateCode
  const taxKind: TaxKind = inv.taxKind ?? deriveTaxKind(issuerState, cust?.stateCode)
  const computed = computeInvoice(s, inv, taxKind)
  const totals = inv.totals ?? computed.totals

  // Group billed lines by part; collect the per-dispatch D.C rows + traceability.
  const byPart = new Map<string, InvoiceDocPartLine>()
  const allPoNos: (string | undefined)[] = []
  const allCustInv: (string | undefined)[] = []
  for (const l of computed.lines) {
    const d = getById(s.inventory.dispatches, l.dispatchId)
    const inw = d ? getById(s.inventory.inwards, d.inwardId) : undefined
    const part = getById(s.masters.parts, l.partId)
    const rmSupplier = inw?.vendorId ? getById(s.masters.vendors, inw.vendorId)?.name : undefined
    allPoNos.push(inw?.poNo)
    allCustInv.push(d?.custInvoiceNo)

    let pl = byPart.get(l.partId)
    if (!pl) {
      pl = {
        partNo: l.partNo,
        partType: part?.description || part?.category || undefined,
        dieNo: inw?.dieNo,
        drgEdtNo: part?.editionNo,
        ircBinNo: inw?.binNo,
        heatNos: [],
        rmSupplier,
        finishWeightG: part ? part.finishWtMg / 1000 : undefined,
        packingMode: part?.packingMode, // Part-master "Packing Mode" (e.g. GSP-2)
        hsnSac: l.hsnSac || part?.hsnSac || '',
        gstPct: l.gstPct,
        dcs: [],
        totalQty: 0,
        totalAmountPaise: 0 as Paise,
      }
      byPart.set(l.partId, pl)
    }
    // Fill representative traceability from whichever dispatch first has it.
    pl.dieNo ??= inw?.dieNo
    pl.ircBinNo ??= inw?.binNo
    pl.rmSupplier ??= rmSupplier
    if (inw?.batchHeatNo && !pl.heatNos.includes(inw.batchHeatNo)) pl.heatNos.push(inw.batchHeatNo)
    pl.dcs.push({
      dcNo: d?.billNo || d?.custInvoiceNo || inw?.challanNo || '—',
      dcDate: d?.billDate ? formatDMY(d.billDate) : d?.dispatchDate ? formatDMY(d.dispatchDate) : undefined,
      qty: l.qty,
      ratePaise: l.ratePaise,
      amountPaise: l.amountPaise,
    })
    pl.totalQty += l.qty
    pl.totalAmountPaise = addP(pl.totalAmountPaise, l.amountPaise)
  }

  const parts = [...byPart.values()]
  const rates = uniq(parts.map((p) => String(p.gstPct)))
  const uniformGstPct = rates.length === 1 ? parts[0]!.gstPct : undefined

  const ps = inv.partySnapshot
  const issuerName = ps?.issuerName ?? issuerVendor?.name ?? unit?.name ?? ''
  const issuerGstin = ps?.issuerGstin ?? issuerVendor?.gstin ?? unit?.gstin ?? ''
  const custName = ps?.custName ?? cust?.name ?? '—'
  const custGstin = ps?.custGstin ?? cust?.gstin ?? ''
  const custAddress = ps?.custAddress ?? cust?.addressLines ?? []
  const shipName = ps?.shippingName || cust?.shippingName || custName
  const shipGstin = ps?.shippingGstin || cust?.shippingGstin || custGstin
  const shipState = ps?.shippingStateCode || cust?.shippingStateCode || ps?.custStateCode || cust?.stateCode || ''
  const shipAddress = ps?.shippingAddress?.length
    ? ps.shippingAddress
    : cust?.shippingAddressLines?.length ? cust.shippingAddressLines : custAddress

  return {
    invoiceNo: inv.billNo,
    invoiceDate: formatDMY(inv.invoiceDate),
    dueDate: inv.dueDate ? formatDMY(inv.dueDate) : undefined,
    taxKind,
    uniformGstPct,
    issuerName,
    issuerGstin,
    issuerPan: panFromGstin(issuerGstin),
    issuerState: ps?.issuerStateCode ?? issuerState ?? '',
    issuerAddress: ps?.issuerAddress ?? issuerVendor?.addressLines ?? unit?.addressLines ?? [],
    issuerBank: unit ? { name: unit.bankName, branch: unit.bankBranch, acc: unit.accountNo, ifsc: unit.ifsc } : undefined,
    poJobworkNo: uniq(allPoNos).join(', ') || undefined,
    custTaxInvoiceNo: uniq(allCustInv).join(', ') || undefined,
    // Optional transport details — entered on the invoice, fall back to derived where sensible.
    ewayBillNo: inv.ewayBillNo || undefined,
    motorVehicleNo: inv.vehicleNo || undefined,
    transporter: inv.transporter || undefined,
    dispatchedThrough: inv.dispatchedThrough || undefined,
    destination: inv.destination || (custAddress.length ? custAddress[custAddress.length - 1] : undefined),
    termsOfPayment: cust?.paymentTermsDays != null ? `${cust.paymentTermsDays} Days Credit` : undefined,
    remark: undefined,
    custName,
    custGstin,
    custPan: cust?.pan || panFromGstin(custGstin),
    custState: ps?.custStateCode ?? cust?.stateCode ?? '',
    custAddress,
    shipName,
    shipGstin,
    shipPan: shipGstin === custGstin && cust?.pan ? cust.pan : panFromGstin(shipGstin),
    shipState,
    shipAddress,
    contactPerson: ps?.custContactPerson ?? cust?.contactPerson,
    contactPhone: ps?.custPhone ?? cust?.phone,
    contactEmail: ps?.custEmail ?? cust?.email,
    freightTerms: ps?.freightTerms ?? cust?.freightTerms,
    transitInsuranceTerms: ps?.transitInsuranceTerms ?? cust?.transitInsuranceTerms,
    gstType: taxKind === 'igst' ? 'Inter State' : 'Intra State',
    sez: ps?.custSez ?? cust?.sez ?? false,
    parts,
    totals,
    packing: inv.packing ?? computed.packing,
    amountWords: toWordsIndian(totals.grand),
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
