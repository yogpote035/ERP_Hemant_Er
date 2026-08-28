/**
 * domain.ts — the normalized data model (see ../../../plan.md §4).
 *
 * The store holds RAW entities + snapshots only. Anything computable
 * (stock, totals, balances, KPIs, payment status, reconciliation) is a
 * memoized SELECTOR, never a stored field. Money is integer `Paise`.
 */
import type { Patch } from 'immer'
import type { Paise } from '@/lib/money'
import type { CommandName } from '@/store/commands'
import type { Module, PermissionOverride, RoleId } from './rbac'

export type Id = string
/** Calendar date as `yyyy-MM-dd`. */
export type ISODate = string

/** Normalized collection: O(1) lookup + stable iteration order. */
export interface Normalized<T> {
  byId: Record<Id, T>
  allIds: Id[]
}

// ── Masters ──────────────────────────────────────────────────────────────────

export interface Unit {
  id: Id
  name: string
  code: string
  gstin: string
  stateCode: string
  addressLines: string[]
  /** Invoice-number template, e.g. `'HEW/{FY}/{seq}'` or `'{seq}/{FY}'`. */
  invoiceFormat: string
  seqPad: number
  bankName?: string
  bankBranch?: string
  accountNo?: string
  ifsc?: string
  logoDataUrl?: string
  active: boolean
}

export interface User {
  id: Id
  name: string
  email: string
  /** Demo only — never verified (frontend-only mock auth). */
  password?: string
  role: RoleId
  assignedUnitIds: Id[]
  overrides?: PermissionOverride
  active: boolean
  createdAt: ISODate
  createdBy?: Id
}

export type VendorType = 'rm' | 'service'

export interface Vendor {
  id: Id
  name: string
  code: string
  type: VendorType
  contactPerson?: string
  phone?: string
  email?: string
  gstin?: string
  pan?: string
  stateCode?: string
  addressLines: string[]
  city?: string
  pincode?: string
  bankName?: string
  accountNo?: string
  ifsc?: string
  /** When this vendor (type 'rm') issues invoices on its own GSTIN. */
  invoiceFormat?: string
  remarks?: string
  active: boolean
}

/** The consignee you bill. */
export interface Customer {
  id: Id
  name: string
  gstin: string
  stateCode: string
  addressLines: string[]
  /** Net-N credit period driving 'overdue'. */
  paymentTermsDays?: number
  active: boolean
}

export interface Part {
  id: Id
  partNo: string
  materialCode: string
  description?: string
  category?: string
  editionNo?: string
  /** A part belongs to exactly ONE unit (SRS FR-RM03a). */
  unitId: Id
  uom: string
  hsnSac: string
  /** GST % per part, configurable (12 Rolex / 18 others). Snapshotted at dispatch. */
  gstPct: number
  /** Finished-ring weight in integer milligrams. */
  finishWtMg: number
  /** Scrap weight per piece in integer milligrams. */
  scrapWtMg: number
  /** Default RM rate per piece (paise) — auto-filled into a new inward, editable there. */
  rmRatePaise?: Paise
  /** Default RM weight per piece in integer milligrams — auto-filled into a new inward. */
  rmWtMg?: number
  /** Avg qty per packing box (drives box auto-calc). */
  avgQtyPerBox: number
  /** Packing-mode code printed on the invoice (e.g. "GSP-2"). */
  packingMode?: string
  /** Default purchase-order reference copied into new inward entries. */
  defaultPoNo?: string
  defaultPoDate?: ISODate
  active: boolean
}

/** Go-live opening stock per (unit, part, FY) — entered, not derived. */
export interface StockOpening {
  id: Id
  unitId: Id
  partId: Id
  fy: string
  openingQty: number
  asOfDate: ISODate
}

/** Versioned RM rate master (append-only). */
export interface RmRate {
  id: Id
  partId: Id
  ratePaise: Paise
  effectiveFrom: ISODate
  supersededAt?: ISODate
}

/** Versioned production rate master (per part + machine + operation). */
export interface ProductionRate {
  id: Id
  partId: Id
  machineId?: Id
  operationId?: Id
  ratePaise: Paise
  effectiveFrom: ISODate
  supersededAt?: ISODate
}

// ── Inward / Dispatch spine ──────────────────────────────────────────────────

export interface Inward {
  id: Id
  unitId: Id
  partId: Id
  vendorId?: Id
  /** Material owner (optional, traceability) — NOT a stock dimension. */
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
  attachmentName?: string
  attachmentMime?: string
  remarks?: string
  createdBy: Id
  createdAt: ISODate
}

export type DispatchKind = 'billed' | 'rejection'

export interface Dispatch {
  id: Id
  /** FK to parent inward; unit/part are inherited via the inward (no own unitId). */
  inwardId: Id
  kind: DispatchKind
  okQty: number
  /** Machine rejection. */
  mcRejQty: number
  /** RM-fault / residue rejection. */
  mfQty: number
  // totalQty = okQty + mcRejQty + mfQty is DERIVED, never stored.
  billNo?: string
  billDate?: ISODate
  dispatchDate?: ISODate
  /** SNAPSHOT at save (null for rejection lines). */
  rateSnapshotPaise?: Paise
  gstPctSnapshot?: number
  /** The customer's own invoice ref (register col 23) — informational. */
  custInvoiceNo?: string
  custInvoiceDate?: ISODate
  remarks?: string
  createdBy: Id
  createdAt: ISODate
}

export type IssuerKind = 'unit' | 'supplier'
export type InvoiceLifecycle = 'draft' | 'sent' | 'void'
export type TaxKind = 'igst' | 'cgst_sgst'

export interface InvoiceTotals {
  assessable: Paise
  cgst: Paise
  sgst: Paise
  igst: Paise
  roundOff: Paise
  grand: Paise
}
export interface PackingBox {
  /** Boxes of this size (full boxes grouped; a remainder makes a 1-box line). */
  boxes: number
  qtyPerBox: number
  /** Packing-mode label printed on the invoice (e.g. "GSP-2"); from the Part master. */
  mode?: string
}

/** A billed line frozen onto the invoice at issue (legal immutability). */
export interface InvoiceLineSnapshot {
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

/** Issuer + consignee identity frozen at issue so editing a master can't rewrite a sent PDF. */
export interface InvoicePartySnapshot {
  custName: string
  custGstin: string
  custStateCode: string
  custAddress: string[]
  issuerName: string
  issuerGstin: string
  issuerStateCode: string
  issuerAddress: string[]
}

export interface Invoice {
  id: Id
  unitId: Id
  /** Consignee, chosen at billing (null on auto-draft). */
  customerId?: Id
  issuerKind: IssuerKind
  issuerId: Id
  /** The Bill No `{seq}/{FY}` — this IS the GST invoice number. */
  billNo: string
  fy: string
  seq: number
  invoiceDate: ISODate
  dueDate?: ISODate
  paymentTerms?: string
  custDcNo?: string
  custDcDate?: ISODate
  // Optional dispatch / transport details printed on the GST invoice.
  ewayBillNo?: string
  vehicleNo?: string
  transporter?: string
  dispatchedThrough?: string
  destination?: string
  dispatchIds: Id[]
  lifecycle: InvoiceLifecycle
  // Snapshotted at issue for legal immutability:
  taxKind?: TaxKind
  totals?: InvoiceTotals
  packing?: PackingBox[]
  /** Frozen party + line identity at issue — readers prefer these for non-draft invoices
   *  so a later master edit can't retroactively rewrite a printed/filed tax invoice. */
  partySnapshot?: InvoicePartySnapshot
  lineSnapshot?: InvoiceLineSnapshot[]
  createdBy: Id
  createdAt: ISODate
}

export type PaymentMode = 'cash' | 'cheque' | 'rtgs' | 'neft' | 'upi' | 'bank'
export interface PaymentAllocation {
  invoiceId: Id
  amountPaise: Paise
}
export interface Payment {
  id: Id
  mode: PaymentMode
  /** Cheque no / RTGS UTR / txn ref. */
  ref: string
  date: ISODate
  amountPaise: Paise
  /** One instrument may settle several bills. */
  allocations: PaymentAllocation[]
}

export type ScrapStatus = 'draft' | 'sent' | 'paid' | 'partial'
export interface ScrapBill {
  id: Id
  unitId: Id
  customerId: Id
  periodFrom: ISODate
  periodTo: ISODate
  /** Integer grams so rate × weight is integer math. */
  weightGrams: number
  ratePerKgPaise: Paise
  gstPct: number
  tcsPct: number
  scrapInvoiceNo: string
  invoiceDate: ISODate
  status: ScrapStatus
  createdBy: Id
  createdAt: ISODate
}

export interface ExpenseInstalment {
  date: ISODate
  amountPaise: Paise
  mode: PaymentMode
  ref?: string
}
export interface Expense {
  id: Id
  unitId: Id
  vendorId?: Id
  vendorName?: string
  /** Item / service description (labelled "Description" in the UI). */
  category: string
  description?: string
  date: ISODate
  dueDate?: ISODate
  // ── line-item + GST breakdown (supplier-bill capture) ──
  hsnSac?: string
  quantity?: number
  ratePaise?: Paise
  /** quantity × rate, before tax. */
  subTotalPaise?: Paise
  igstPct?: number
  cgstPct?: number
  sgstPct?: number
  tcsPct?: number
  supplierInvoiceNo?: string
  /** Sub total + IGST + CGST + SGST + TCS. */
  totalPaise: Paise
  instalments: ExpenseInstalment[]
  createdBy: Id
  createdAt: ISODate
}

export type RejectionWeightBasis = 'finish' | 'scrap'
export interface RejectionAdvice {
  id: Id
  unitId: Id
  customerId: Id
  partId: Id
  sourceInwardId: Id
  rejDcNo: string
  rejDate: ISODate
  mrQty: number
  frQty: number
  weightBasis: RejectionWeightBasis
  weightPerRingMg: number
  totalWeightGrams: number
  createdBy: Id
  createdAt: ISODate
}

// ── HR / Attendance ──────────────────────────────────────────────────────────

export interface Machine {
  id: Id
  machineNo: string
  description?: string
  unitId: Id
  active: boolean
}
export interface Operation {
  id: Id
  code: string
  description?: string
  active: boolean
}
export type LabourType = 'production' | 'shift' | 'both'
export interface Employee {
  id: Id
  name: string
  empCode: string
  phone?: string
  labourType: LabourType
  standardShiftRatePaise: Paise
  unitId: Id
  active: boolean
}
export interface ProductionAttendance {
  id: Id
  unitId: Id
  date: ISODate
  /** Shift No (A / B / C / General). */
  shiftNo?: string
  employeeId: Id
  machineId: Id
  partId: Id
  operationId?: Id
  /** Production-planning readings — surfaced as "Standard" / "Plan" in the UI. */
  openingCounter: number // Standard
  closingCounter: number // Plan
  /** Total pieces made (client "Total Mat"). Legacy rows fall back to closing−opening. */
  totalMakeQty?: number
  /** Production breakdown — OK + Scrap + Rework + MF reconciles to totalMakeQty. */
  okQty: number
  scrapQty?: number
  reworkQty?: number
  mfQty?: number
  /** Down-time window (`HH:mm`) + free-text remark; total minutes are DERIVED. */
  downtimeFrom?: string
  downtimeTo?: string
  remark?: string
  rateSnapshotPaise: Paise
  // earned = okQty * rateSnapshotPaise (DERIVED)
  createdBy: Id
  createdAt: ISODate
}
export interface ShiftAttendance {
  id: Id
  unitId: Id
  date: ISODate
  shiftNo?: string
  employeeId: Id
  /** `HH:mm`. */
  fromTime: string
  toTime: string
  // hours = toTime - fromTime; wage = hours/8 * shiftRate (DERIVED)
  shiftRateSnapshotPaise: Paise
  otHours?: number
  otRateSnapshotPaise?: Paise
  createdBy: Id
  createdAt: ISODate
}

// ── System: audit + undo + optional physical count ───────────────────────────

export interface ActivityLogEntry {
  id: Id
  ts: string
  userId: Id
  unitId?: Id
  command: CommandName
  /** Frozen human summary at write time (drives feed + audit). */
  summary: string
  refs: { type: string; id: Id }[]
}

export interface UndoRecord {
  id: Id
  ts: string
  command: CommandName
  /** Forward patches (for redo) and their inverse (for undo). */
  patches: Patch[]
  inversePatches: Patch[]
  summary: string
}

/** Optional physical stock count — when present, reconcile I5 asserts derived === counted. */
export interface StockSnapshot {
  id: Id
  unitId: Id
  partId: Id
  asOfDate: ISODate
  countedQty: number
}

/** Active user + active unit context. NOT persisted. */
export interface Session {
  currentUserId: Id | null
  currentUnitId: Id | 'ALL' | null
}

/** Per-(issuerId:FY) running invoice/bill sequence counters. */
export type SequenceCounters = Record<string, number>

/** Convenience union for activity refs / generic entity addressing. */
export type EntityKind =
  | 'unit'
  | 'user'
  | 'vendor'
  | 'customer'
  | 'part'
  | 'inward'
  | 'dispatch'
  | 'invoice'
  | 'payment'
  | 'scrapBill'
  | 'expense'
  | 'rejectionAdvice'

export type { Module }
