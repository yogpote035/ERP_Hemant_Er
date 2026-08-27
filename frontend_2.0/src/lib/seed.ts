/**
 * Deterministic demo seed (plan §7 P0). Grounded in the real client data:
 *  - 7 units (u1 = real HEW identity), 11 real PART MASTER parts + 2 demo parts
 *  - Rolex (state 24, Gujarat → IGST) + an intra-MH + an inter-state customer
 *  - the golden challan 8202421273 split 28000 → 12020 / 14000 / 242-rej(DC15) / 1738
 *  - openings chosen so every (unit,part) ledger reconciles GREEN
 *  - 4 RBAC users (admin / manager / 2 operators across 2 units)
 *
 * Stable ids + fixed timestamps make reconcile and snapshot tests repeatable.
 */
import type {
  Customer,
  Dispatch,
  Employee,
  Expense,
  Inward,
  Invoice,
  Machine,
  Operation,
  Part,
  Payment,
  ProductionAttendance,
  ProductionRate,
  RejectionAdvice,
  RmRate,
  ScrapBill,
  ShiftAttendance,
  StockOpening,
  Unit,
  User,
  Vendor,
} from '@/types/domain'
import { toPaise } from './money'
import { seedRoleDefs } from '@/types/rbac'
import { getById, putEntity, values } from '@/store/normalized'
import { computeInvoice, deriveTaxKind } from '@/selectors/invoiceCompute'
import { createEmptyState, type RootState } from '@/store/state'

/** Demo-dataset version. Bump when adding new demo collections so already-seeded
 *  stores backfill them on next load (see the store's merge()). v2 added
 *  expenses, rejection advices and rate masters. */
export const SEED_VERSION = 2

const TS = '2025-04-01T00:00:00.000Z'
const ADMIN = 'u-admin'
/** kg → milligrams. finishWtMg/scrapWtMg are TRUE milligrams (domain.ts), which
 *  the Parts form (÷1000 → g), the rejection weight math and the scrap weight
 *  basis all rely on. (Was ×1000 = grams, which made UI-created rejection weights
 *  ~1000× too small.) */
const mg = (kg: number) => Math.round(kg * 1e6)

// ── Units ────────────────────────────────────────────────────────────────────
const UNITS: Unit[] = [
  {
    id: 'u1', name: 'Hemant Engineering Works', code: 'HEW', gstin: '27ADGPV9846A1Z6', stateCode: '27',
    addressLines: ['GAT NO. 44, CHIMBALI PHATA', 'TAL KHED, PUNE 412105', 'Maharashtra'],
    invoiceFormat: '{seq}/{FY}', seqPad: 0,
    bankName: 'HDFC Bank', accountNo: '50200012345678', ifsc: 'HDFC0000123', active: true,
  },
  { id: 'u2', name: 'Hemant Forge Unit-2', code: 'HFU2', gstin: '27ADGPV9846A2Z5', stateCode: '27', addressLines: ['Plot 12, Chakan MIDC', 'Pune 410501', 'Maharashtra'], invoiceFormat: 'HFU2/{FY}/{seq}', seqPad: 3, bankName: 'HDFC Bank', accountNo: '50200012345679', ifsc: 'HDFC0000123', active: true },
  { id: 'u3', name: 'Hemant Precision Unit-3', code: 'HPU3', gstin: '27ADGPV9846A3Z4', stateCode: '27', addressLines: ['Plot 7, Bhosari MIDC', 'Pune 411026', 'Maharashtra'], invoiceFormat: 'HPU3/{seq}/{FY}', seqPad: 4, active: true },
  { id: 'u4', name: 'Hemant Auto Components Unit-4', code: 'HAC4', gstin: '27ADGPV9846A4Z3', stateCode: '27', addressLines: ['Shed 3, Ranjangaon MIDC', 'Pune 412220', 'Maharashtra'], invoiceFormat: 'HAC4-{seq}/{FY}', seqPad: 3, active: true },
  { id: 'u5', name: 'Hemant Heat Treat Unit-5', code: 'HHT5', gstin: '27ADGPV9846A5Z2', stateCode: '27', addressLines: ['Plot 21, Chakan MIDC Ph-II', 'Pune 410501', 'Maharashtra'], invoiceFormat: 'HHT5/{FY}/{seq}', seqPad: 3, active: true },
  { id: 'u6', name: 'Hemant Tooling Unit-6', code: 'HTL6', gstin: '27ADGPV9846A6Z1', stateCode: '27', addressLines: ['Gat 88, Kuruli', 'Pune 410501', 'Maharashtra'], invoiceFormat: 'HTL6/{seq}/{FY}', seqPad: 3, active: true },
  { id: 'u7', name: 'Hemant Assemblies Unit-7', code: 'HAS7', gstin: '27ADGPV9846A7Z0', stateCode: '27', addressLines: ['Plot 5, Talegaon MIDC', 'Pune 410507', 'Maharashtra'], invoiceFormat: 'HAS7/{FY}/{seq}', seqPad: 3, active: true },
]
const ALL_UNIT_IDS = UNITS.map((u) => u.id)

// ── Parts (11 real PART MASTER + 2 demo) ──────────────────────────────────────
interface RealPart { partNo: string; edition: string; finishKg: number; scrapKg: number; bags: number }
const REAL_PARTS: RealPart[] = [
  { partNo: 'OM-6308-A-2RS', edition: '3/19 09', finishKg: 0.308, scrapKg: 0.162, bags: 50 },
  { partNo: 'OM-6308-A-2RS-N', edition: '1/22 04', finishKg: 0.302, scrapKg: 0.164, bags: 50 },
  { partNo: 'IM-6308-ALS', edition: '2/19 09', finishKg: 0.188, scrapKg: 0.093, bags: 80 },
  { partNo: 'IM-6309', edition: '7/17 05', finishKg: 0.2354, scrapKg: 0.119, bags: 60 },
  { partNo: 'OM-6309-B-2RS', edition: '9/14 10', finishKg: 0.3938, scrapKg: 0.196, bags: 50 },
  { partNo: 'IM-6310-ALS', edition: '5/14 10', finishKg: 0.3, scrapKg: 0.141, bags: 50 },
  { partNo: 'OM-6310-A-2RS', edition: '11/20 08', finishKg: 0.504, scrapKg: 0.241, bags: 40 },
  { partNo: 'IM-6311', edition: '4/14 10', finishKg: 0.386, scrapKg: 0.161, bags: 40 },
  { partNo: 'OM-6311-2RS', edition: '5/20 08', finishKg: 0.652, scrapKg: 0.268, bags: 30 },
  { partNo: 'IM-6312-A', edition: '4/14 10', finishKg: 0.476, scrapKg: 0.215, bags: 40 },
  { partNo: 'OM-6312-B-2RS', edition: '5/20 08', finishKg: 0.794, scrapKg: 0.324, bags: 30 },
]
const PARTS: Part[] = [
  ...REAL_PARTS.map((rp, i): Part => ({
    id: `p${i + 1}`,
    partNo: rp.partNo,
    materialCode: `RM-${String(i + 1).padStart(3, '0')}`,
    description: 'Bearing ring (job-work machining)',
    editionNo: rp.edition,
    unitId: 'u1',
    uom: 'NOS',
    hsnSac: '84829900',
    gstPct: 12,
    finishWtMg: mg(rp.finishKg),
    scrapWtMg: mg(rp.scrapKg),
    avgQtyPerBox: 1050, // realistic GSP wooden-box capacity (matches the client invoice)
    packingMode: 'GSP-2',
    active: true,
  })),
  { id: 'p12', partNo: 'DM-1001', materialCode: 'RM-012', description: 'Demo machined hub', unitId: 'u2', uom: 'NOS', hsnSac: '84833000', gstPct: 18, finishWtMg: mg(0.5), scrapWtMg: mg(0.2), avgQtyPerBox: 800, packingMode: 'GSP-1', active: true },
  { id: 'p13', partNo: 'DM-1002', materialCode: 'RM-013', description: 'Demo machined flange', unitId: 'u2', uom: 'NOS', hsnSac: '84833000', gstPct: 18, finishWtMg: mg(0.7), scrapWtMg: mg(0.3), avgQtyPerBox: 600, packingMode: 'GSP-1', active: true },
]

// ── Customers / Vendors ───────────────────────────────────────────────────────
const CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Rolex Rings Limited', gstin: '24AACCR3790B1ZO', stateCode: '24', addressLines: ['Gondal Road, Nr Railway Crossing', 'Village Kothriya, Rajkot-360004', 'Gujarat'], paymentTermsDays: 45, active: true },
  { id: 'c2', name: 'Yenkay Engineering Pvt Ltd', gstin: '27AABCY1234C1Z8', stateCode: '27', addressLines: ['Plot 14, MIDC Bhosari', 'Pune 411026', 'Maharashtra'], paymentTermsDays: 30, active: true },
  { id: 'c3', name: 'SKF India Ltd', gstin: '29AAACS1234D1Z1', stateCode: '29', addressLines: ['Mahadevapura', 'Bangalore 560048', 'Karnataka'], paymentTermsDays: 30, active: true },
]
const VENDORS: Vendor[] = [
  { id: 'v1', name: 'Sunflag Iron & Steel', code: 'VND-001', type: 'rm', gstin: '27AAACS5678E1Z3', pan: 'AAACS5678E', stateCode: '27', addressLines: ['Bhandara Road', 'Nagpur 441401'], city: 'Nagpur', pincode: '441401', bankName: 'SBI', accountNo: '3012345678', ifsc: 'SBIN0001234', invoiceFormat: 'SUN/{FY}/{seq}', active: true },
  { id: 'v2', name: 'Pune Tool Traders', code: 'VND-002', type: 'service', gstin: '27AAFCP4321F1Z9', stateCode: '27', addressLines: ['Shivajinagar', 'Pune 411005'], active: true },
  { id: 'v3', name: 'Khed Coolants & Oils', code: 'VND-003', type: 'service', stateCode: '27', addressLines: ['Chakan', 'Pune 410501'], active: true },
]

// ── Users ──────────────────────────────────────────────────────────────────────
const USERS: User[] = [
  { id: ADMIN, name: 'Hemant V. (Admin)', email: 'admin@hew.in', password: 'demo', role: 'admin', assignedUnitIds: ALL_UNIT_IDS, active: true, createdAt: TS },
  { id: 'u-mgr', name: 'Manjiri M. (Manager)', email: 'manager@hew.in', password: 'demo', role: 'manager', assignedUnitIds: ['u1', 'u2'], active: true, createdAt: TS },
  { id: 'u-op1', name: 'Operator A', email: 'opa@hew.in', password: 'demo', role: 'operator', assignedUnitIds: ['u1'], active: true, createdAt: TS },
  { id: 'u-op2', name: 'Operator B', email: 'opb@hew.in', password: 'demo', role: 'operator', assignedUnitIds: ['u2'], active: true, createdAt: TS },
]

// ── Opening stock (chosen so ledgers reconcile GREEN) ─────────────────────────
const OPENINGS: StockOpening[] = [
  { id: 'so1', unitId: 'u1', partId: 'p6', fy: '24-25', openingQty: 2000, asOfDate: '2024-04-01' },
  { id: 'so2', unitId: 'u1', partId: 'p9', fy: '24-25', openingQty: 1000, asOfDate: '2024-04-01' },
]

// ── Inward / Dispatch spine ───────────────────────────────────────────────────
function inward(o: Partial<Inward> & Pick<Inward, 'id' | 'partId' | 'challanNo' | 'receivedQty'>): Inward {
  return {
    unitId: 'u1', customerId: 'c1', challanDate: '2025-01-09', batchHeatNo: '1090465-SUN-55012',
    vendorId: 'v1', createdBy: ADMIN, createdAt: TS, ...o,
  }
}
function billed(id: string, inwardId: string, okQty: number, billNo: string, rateRs: number, over: Partial<Dispatch> = {}): Dispatch {
  return {
    id, inwardId, kind: 'billed', okQty, mcRejQty: 0, mfQty: 0, billNo,
    billDate: '2025-02-07', dispatchDate: '2025-02-02', rateSnapshotPaise: toPaise(rateRs), gstPctSnapshot: 12,
    createdBy: ADMIN, createdAt: TS, ...over,
  }
}
function rejection(id: string, inwardId: string, mcRejQty: number, billNo: string, over: Partial<Dispatch> = {}): Dispatch {
  return {
    id, inwardId, kind: 'rejection', okQty: 0, mcRejQty, mfQty: 0, billNo,
    billDate: '2025-02-08', createdBy: ADMIN, createdAt: TS, ...over,
  }
}

const INWARDS: Inward[] = [
  inward({ id: 'i1', partId: 'p3', challanNo: '8202421273', receivedQty: 28000, poNo: '1190422486' }),
  inward({ id: 'i2', partId: 'p1', challanNo: '8202421270', receivedQty: 4000, batchHeatNo: '1090469-SUN-55012', poNo: '1190422483' }),
  inward({ id: 'i3', partId: 'p1', challanNo: '8202421381', receivedQty: 15000, challanDate: '2025-01-10', batchHeatNo: '1090469-SUN-55012', poNo: '1190422594' }),
  inward({ id: 'i4', partId: 'p6', challanNo: 'ROLEX-IH-1001', receivedQty: 10000, challanDate: '2025-03-01' }),
  inward({ id: 'i5', partId: 'p9', challanNo: 'ROLEX-PR-1002', receivedQty: 8000, challanDate: '2025-03-05' }),
]

const DISPATCHES: Dispatch[] = [
  // i1 — the golden split (12020 + 14000 + 242 rejection + 1738 = 28000)
  billed('d1', 'i1', 12020, '255/24-25', 5.1, { dispatchDate: '2025-02-02' }),
  billed('d2', 'i1', 14000, '255/24-25', 5.1, { dispatchDate: '2025-02-04' }),
  rejection('d3', 'i1', 242, 'DC15'),
  billed('d4', 'i1', 1738, '268/24-25', 5.1, { billDate: '2025-03-08', dispatchDate: '2025-03-03' }),
  // i2 — fully dispatched
  billed('d5', 'i2', 4000, '254/24-25', 7.95),
  // i3 — fully dispatched, second line at the -N variant rate
  billed('d6', 'i3', 13235, '254/24-25', 7.95),
  billed('d7', 'i3', 1765, '254/24-25', 8.25, { remarks: '2RS-N' }),
  // i5 — partial (3000 of 8000)
  billed('d8', 'i5', 3000, '270/24-25', 9.0, { billDate: '2025-03-08', dispatchDate: '2025-03-06' }),
  // i4 — no dispatch → In-house
]

// ── Invoices (grouped by Bill No) + a payment ─────────────────────────────────
function invoice(billNo: string, seq: number, dispatchIds: string[], lifecycle: Invoice['lifecycle'], date: string): Invoice {
  return {
    id: `inv-${seq}`, unitId: 'u1', customerId: 'c1', issuerKind: 'unit', issuerId: 'u1',
    billNo, fy: '24-25', seq, invoiceDate: date, dispatchIds, lifecycle, createdBy: ADMIN, createdAt: TS,
  }
}
const INVOICES: Invoice[] = [
  invoice('254/24-25', 254, ['d5', 'd6', 'd7'], 'sent', '2025-02-07'),
  invoice('255/24-25', 255, ['d1', 'd2'], 'sent', '2025-02-07'),
  invoice('268/24-25', 268, ['d4'], 'sent', '2025-03-08'),
  invoice('270/24-25', 270, ['d8'], 'draft', '2025-03-08'),
]
const PAYMENTS: Payment[] = [
  { id: 'pay1', mode: 'rtgs', ref: '18115287', date: '2025-03-27', amountPaise: toPaise(169769.04), allocations: [{ invoiceId: 'inv-254', amountPaise: toPaise(169769.04) }] },
]

// ── Scrap bills (real numbers, TCS) ───────────────────────────────────────────
const SCRAP: ScrapBill[] = [
  { id: 'sc1', unitId: 'u1', customerId: 'c1', periodFrom: '2023-06-26', periodTo: '2023-07-10', weightGrams: 7_117_000, ratePerKgPaise: toPaise(34.5), gstPct: 18, tcsPct: 1, scrapInvoiceNo: '1202304726', invoiceDate: '2023-07-12', status: 'paid', createdBy: ADMIN, createdAt: TS },
  { id: 'sc2', unitId: 'u1', customerId: 'c1', periodFrom: '2023-07-26', periodTo: '2023-08-10', weightGrams: 12_942_000, ratePerKgPaise: toPaise(33), gstPct: 18, tcsPct: 1, scrapInvoiceNo: '1202306435', invoiceDate: '2023-08-12', status: 'sent', createdBy: ADMIN, createdAt: TS },
]

// ── HR ────────────────────────────────────────────────────────────────────────
const MACHINES: Machine[] = [
  { id: 'm1', machineNo: 'MC-01', description: 'CNC Turning', unitId: 'u1', active: true },
  { id: 'm2', machineNo: 'MC-02', description: 'CNC Turning', unitId: 'u1', active: true },
]
const OPERATIONS: Operation[] = [
  { id: 'op-1r', code: '1R', description: '1st Rough', active: true },
  { id: 'op-1f', code: '1F', description: '1st Finish', active: true },
]
const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Ramesh Patil', empCode: 'E001', phone: '9800000001', labourType: 'production', standardShiftRatePaise: toPaise(800), unitId: 'u1', active: true },
  { id: 'e2', name: 'Suresh Jadhav', empCode: 'E002', phone: '9800000002', labourType: 'shift', standardShiftRatePaise: toPaise(700), unitId: 'u1', active: true },
]
const PRODUCTION: ProductionAttendance[] = [
  // OK 1180 + Scrap 15 + Rework 5 + MF 0 = 1200 = totalMakeQty (reconciles).
  { id: 'pa1', unitId: 'u1', date: '2025-02-02', shiftNo: 'A', employeeId: 'e1', machineId: 'm1', partId: 'p3', operationId: 'op-1f', openingCounter: 1200, closingCounter: 1250, totalMakeQty: 1200, okQty: 1180, scrapQty: 15, reworkQty: 5, mfQty: 0, downtimeFrom: '13:00', downtimeTo: '13:30', remark: 'Tea + tool change', rateSnapshotPaise: toPaise(2.5), createdBy: ADMIN, createdAt: TS },
]
const SHIFTS: ShiftAttendance[] = [
  { id: 'sh1', unitId: 'u1', date: '2025-02-02', shiftNo: 'A', employeeId: 'e2', fromTime: '09:00', toTime: '17:00', shiftRateSnapshotPaise: toPaise(700), otHours: 1, otRateSnapshotPaise: toPaise(110), createdBy: ADMIN, createdAt: TS },
]

// ── Rate masters (versioned; "current" = not superseded, latest effectiveFrom) ─
const RM_RATES: RmRate[] = [
  // p3 shows the versioning: an older rate superseded by the current one.
  { id: 'rmr1', partId: 'p3', ratePaise: toPaise(58), effectiveFrom: '2024-04-01', supersededAt: '2025-01-01' },
  { id: 'rmr2', partId: 'p3', ratePaise: toPaise(62), effectiveFrom: '2025-01-01' },
  { id: 'rmr3', partId: 'p1', ratePaise: toPaise(64), effectiveFrom: '2024-04-01' },
  { id: 'rmr4', partId: 'p6', ratePaise: toPaise(66), effectiveFrom: '2024-04-01' },
  { id: 'rmr5', partId: 'p9', ratePaise: toPaise(70), effectiveFrom: '2024-04-01' },
]
const PRODUCTION_RATES: ProductionRate[] = [
  // p3 / 1st-finish current rate matches the seeded production attendance snapshot (₹2.50).
  { id: 'pr1', partId: 'p3', operationId: 'op-1f', ratePaise: toPaise(2.5), effectiveFrom: '2024-04-01' },
  { id: 'pr2', partId: 'p3', operationId: 'op-1r', ratePaise: toPaise(2.0), effectiveFrom: '2024-04-01' },
  { id: 'pr3', partId: 'p1', operationId: 'op-1f', ratePaise: toPaise(3.0), effectiveFrom: '2024-04-01' },
  { id: 'pr4', partId: 'p6', operationId: 'op-1f', ratePaise: toPaise(2.8), effectiveFrom: '2024-04-01' },
]

// ── Expenses (overheads with instalment tracking; balance/status derived) ──────
const EXPENSES: Expense[] = [
  // Fully paid (one instalment clears the total).
  { id: 'exp1', unitId: 'u1', vendorId: 'v3', vendorName: 'Khed Coolants & Oils', category: 'Consumables', description: 'Cutting oil + coolant (Feb)', date: '2025-02-05', dueDate: '2025-03-07', totalPaise: toPaise(48500), instalments: [{ date: '2025-02-20', amountPaise: toPaise(48500), mode: 'rtgs', ref: 'NEFT-22119' }], createdBy: ADMIN, createdAt: TS },
  // Partially paid.
  { id: 'exp2', unitId: 'u1', category: 'Electricity', description: 'MSEDCL power bill (Feb)', date: '2025-02-10', dueDate: '2025-02-28', totalPaise: toPaise(213400), instalments: [{ date: '2025-02-26', amountPaise: toPaise(100000), mode: 'rtgs', ref: 'UTIB-7781' }], createdBy: ADMIN, createdAt: TS },
  // Unpaid (no instalments).
  { id: 'exp3', unitId: 'u1', vendorId: 'v2', vendorName: 'Pune Tool Traders', category: 'Tooling', description: 'Carbide inserts + tool holders', date: '2025-02-18', dueDate: '2025-03-20', totalPaise: toPaise(76250), instalments: [], createdBy: ADMIN, createdAt: TS },
  // Paid across two cheques.
  { id: 'exp4', unitId: 'u1', category: 'Rent', description: 'Factory shed rent (Feb)', date: '2025-02-01', dueDate: '2025-02-05', totalPaise: toPaise(120000), instalments: [{ date: '2025-02-03', amountPaise: toPaise(60000), mode: 'cheque', ref: 'CHQ-551020' }, { date: '2025-02-19', amountPaise: toPaise(60000), mode: 'cheque', ref: 'CHQ-551044' }], createdBy: ADMIN, createdAt: TS },
  // Unit-2 overhead.
  { id: 'exp5', unitId: 'u2', category: 'Maintenance', description: 'AMC — compressor (HFU2)', date: '2025-02-22', dueDate: '2025-03-24', totalPaise: toPaise(34000), instalments: [], createdBy: ADMIN, createdAt: TS },
]

// ── Rejection advices (rejected-material DCs; weight = qty × per-ring weight) ───
// totalWeightGrams mirrors runSaveRejectionAdvice: round(qty × weightPerRingMg / 1000).
const REJECTIONS: RejectionAdvice[] = [
  // From the golden challan's 242-pc machine rejection (p3 scrap weight 93 g/pc).
  { id: 'rej1', unitId: 'u1', customerId: 'c1', partId: 'p3', sourceInwardId: 'i1', rejDcNo: 'RJ/24-25/01', rejDate: '2025-02-10', mrQty: 242, frQty: 0, weightBasis: 'scrap', weightPerRingMg: 93000, totalWeightGrams: 22506, createdBy: ADMIN, createdAt: TS },
  // p1 (OM-6308-A-2RS, scrap 162 g/pc): 120 MR + 30 FR.
  { id: 'rej2', unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'RJ/24-25/02', rejDate: '2025-02-15', mrQty: 120, frQty: 30, weightBasis: 'scrap', weightPerRingMg: 162000, totalWeightGrams: 24300, createdBy: ADMIN, createdAt: TS },
  // p9 (OM-6311-2RS) on finish-weight basis (652 g/pc).
  { id: 'rej3', unitId: 'u1', customerId: 'c1', partId: 'p9', sourceInwardId: 'i5', rejDcNo: 'RJ/24-25/03', rejDate: '2025-03-07', mrQty: 60, frQty: 0, weightBasis: 'finish', weightPerRingMg: 652000, totalWeightGrams: 39120, createdBy: ADMIN, createdAt: TS },
]

/** Build a fully-seeded RootState (deterministic). */
export function seedState(): RootState {
  const s = createEmptyState()
  UNITS.forEach((u) => putEntity(s.masters.units, u))
  seedRoleDefs().forEach((r) => putEntity(s.masters.roles, r))
  USERS.forEach((u) => putEntity(s.masters.users, u))
  CUSTOMERS.forEach((c) => putEntity(s.masters.customers, c))
  VENDORS.forEach((v) => putEntity(s.masters.vendors, v))
  PARTS.forEach((p) => putEntity(s.masters.parts, p))
  OPENINGS.forEach((o) => putEntity(s.masters.stockOpenings, o))
  MACHINES.forEach((m) => putEntity(s.masters.machines, m))
  OPERATIONS.forEach((o) => putEntity(s.masters.operations, o))
  EMPLOYEES.forEach((e) => putEntity(s.masters.employees, e))
  RM_RATES.forEach((r) => putEntity(s.masters.rmRates, r))
  PRODUCTION_RATES.forEach((r) => putEntity(s.masters.productionRates, r))
  INWARDS.forEach((i) => putEntity(s.inventory.inwards, i))
  DISPATCHES.forEach((d) => putEntity(s.inventory.dispatches, d))
  INVOICES.forEach((i) => putEntity(s.billing.invoices, i))
  PAYMENTS.forEach((p) => putEntity(s.payments.payments, p))
  SCRAP.forEach((sc) => putEntity(s.scrap.scrapBills, sc))
  EXPENSES.forEach((e) => putEntity(s.expenses.expenses, e))
  REJECTIONS.forEach((r) => putEntity(s.rejection.rejectionAdvices, r))
  PRODUCTION.forEach((p) => putEntity(s.hr.production, p))
  SHIFTS.forEach((sh) => putEntity(s.hr.shifts, sh))
  // Snapshot totals/taxKind/packing onto every NON-draft invoice (mirrors
  // finalizeInvoice) so the billing table, dashboard receivables KPIs and the
  // payments outstanding list read real money instead of ₹0.
  for (const inv of values(s.billing.invoices)) {
    if (inv.lifecycle === 'draft') continue
    const unit = getById(s.masters.units, inv.unitId)
    const cust = getById(s.masters.customers, inv.customerId)
    const taxKind = deriveTaxKind(unit?.stateCode, cust?.stateCode)
    const c = computeInvoice(s, inv, taxKind)
    putEntity(s.billing.invoices, { ...inv, taxKind, totals: c.totals, packing: c.packing })
  }

  s.system.sequences = { 'u1:24-25': 271 }
  s.system.seeded = true
  s.system.seedVersion = SEED_VERSION
  return s
}
