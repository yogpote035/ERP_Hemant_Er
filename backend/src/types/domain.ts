/**
 * domain.ts — normalized data model, ported from the frontend. Server holds RAW
 * entities + snapshots only; stock/totals/balances/status are computed by selectors.
 * Money is integer `Paise`. (Frontend-only bits — immer Patch undo records — dropped.)
 */
import type { Paise } from '../lib/money.js'
import type { Module, PermissionOverride, RoleId } from './rbac.js'

export type Id = string
export type ISODate = string

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
  /** Bcrypt hash (never returned by the API). */
  passwordHash?: string
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
  /** Unit that owns and may use this vendor. Legacy records can be inferred from transactions. */
  unitId?: Id
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
  invoiceFormat?: string
  remarks?: string
  active: boolean
}

export interface Customer {
  id: Id
  name: string
  gstin: string
  pan?: string
  stateCode: string
  addressLines: string[]
  shippingName?: string
  shippingAddressLines?: string[]
  shippingGstin?: string
  shippingStateCode?: string
  contactPerson?: string
  phone?: string
  email?: string
  freightTerms?: string
  transitInsuranceTerms?: string
  sez?: boolean
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
  unitId: Id
  uom: string
  hsnSac: string
  gstPct: number
  finishWtMg: number
  scrapWtMg: number
  /** Default RM rate per piece (paise) — auto-filled into a new inward, editable there. */
  rmRatePaise?: Paise
  /** Default RM weight per piece in integer milligrams — auto-filled into a new inward. */
  rmWtMg?: number
  avgQtyPerBox: number
  packingMode?: string
  defaultPoNo?: string
  defaultPoDate?: ISODate
  active: boolean
}

export interface StockOpening {
  id: Id
  unitId: Id
  partId: Id
  fy: string
  openingQty: number
  asOfDate: ISODate
}

export interface RmRate {
  id: Id
  partId: Id
  ratePaise: Paise
  effectiveFrom: ISODate
  supersededAt?: ISODate
}

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
  /** Scanned challan/invoice attachment — original filename + mime; bytes live on
   *  disk (data/uploads/<inwardId>), referenced by GET /inward/:id/attachment. */
  attachmentName?: string
  attachmentMime?: string
  remarks?: string
  createdBy: Id
  createdAt: ISODate
}

export type DispatchKind = 'billed' | 'rejection'

export interface Dispatch {
  id: Id
  inwardId: Id
  kind: DispatchKind
  okQty: number
  mcRejQty: number
  mfQty: number
  billNo?: string
  billDate?: ISODate
  dispatchDate?: ISODate
  rateSnapshotPaise?: Paise
  gstPctSnapshot?: number
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
  boxes: number
  qtyPerBox: number
  mode?: string
}

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

export interface InvoicePartySnapshot {
  custName: string
  custGstin: string
  custStateCode: string
  custAddress: string[]
  shippingName?: string
  shippingAddress?: string[]
  shippingGstin?: string
  shippingStateCode?: string
  custContactPerson?: string
  custPhone?: string
  custEmail?: string
  freightTerms?: string
  transitInsuranceTerms?: string
  custSez?: boolean
  issuerName: string
  issuerGstin: string
  issuerStateCode: string
  issuerAddress: string[]
}

export interface Invoice {
  id: Id
  unitId: Id
  customerId?: Id
  issuerKind: IssuerKind
  issuerId: Id
  billNo: string
  fy: string
  seq: number
  invoiceDate: ISODate
  dueDate?: ISODate
  paymentTerms?: string
  custDcNo?: string
  custDcDate?: ISODate
  ewayBillNo?: string
  vehicleNo?: string
  transporter?: string
  dispatchedThrough?: string
  destination?: string
  dispatchIds: Id[]
  lifecycle: InvoiceLifecycle
  taxKind?: TaxKind
  totals?: InvoiceTotals
  packing?: PackingBox[]
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
  ref: string
  date: ISODate
  amountPaise: Paise
  allocations: PaymentAllocation[]
}

export type ScrapStatus = 'draft' | 'sent' | 'paid' | 'partial'
export interface ScrapBill {
  id: Id
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
  shiftNo?: string
  employeeId: Id
  machineId: Id
  partId: Id
  operationId?: Id
  openingCounter: number
  closingCounter: number
  totalMakeQty?: number
  okQty: number
  scrapQty?: number
  reworkQty?: number
  mfQty?: number
  downtimeFrom?: string
  downtimeTo?: string
  remark?: string
  rateSnapshotPaise: Paise
  createdBy: Id
  createdAt: ISODate
}
export interface ShiftAttendance {
  id: Id
  unitId: Id
  date: ISODate
  shiftNo?: string
  employeeId: Id
  fromTime: string
  toTime: string
  shiftRateSnapshotPaise: Paise
  otHours?: number
  otRateSnapshotPaise?: Paise
  createdBy: Id
  createdAt: ISODate
}

// ── System ────────────────────────────────────────────────────────────────────

export interface ActivityLogEntry {
  id: Id
  ts: string
  userId: Id
  unitId?: Id
  command: string
  summary: string
  refs: { type: string; id: Id }[]
}

export interface StockSnapshot {
  id: Id
  unitId: Id
  partId: Id
  asOfDate: ISODate
  countedQty: number
}

export type SequenceCounters = Record<string, number>

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
