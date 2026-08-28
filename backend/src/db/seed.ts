/**
 * Deterministic demo seed, ported from the frontend (subset sufficient for every
 * module's APIs + smoke tests). Demo users carry a bcrypt hash of `demo`.
 * Invoice totals are snapshotted later by the billing module when it loads.
 */
import bcrypt from 'bcryptjs'
import { toPaise } from '../lib/money.js'
import { seedRoleDefs } from '../types/rbac.js'
import { putEntity, getById, values } from './normalized.js'
import { createEmptyState, type RootState } from './state.js'
import { computeInvoice, deriveTaxKind } from '../domain/invoiceCompute.js'
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
} from '../types/domain.js'

export const SEED_VERSION = 2

const TS = '2025-04-01T00:00:00.000Z'
const ADMIN = 'u-admin'
const DEMO_HASH = bcrypt.hashSync('demo', 10)
const mg = (kg: number) => Math.round(kg * 1e6)

const UNITS: Unit[] = [
  { id: 'u1', name: 'Hemant Engineering Works', code: 'HEW', gstin: '27ADGPV9846A1Z6', stateCode: '27', addressLines: ['GAT NO. 44, CHIMBALI PHATA', 'TAL KHED, PUNE 412105', 'Maharashtra'], invoiceFormat: '{seq}/{FY}', seqPad: 0, bankName: 'HDFC Bank', accountNo: '50200012345678', ifsc: 'HDFC0000123', active: true },
  { id: 'u2', name: 'Hemant Forge Unit-2', code: 'HFU2', gstin: '27ADGPV9846A2Z5', stateCode: '27', addressLines: ['Plot 12, Chakan MIDC', 'Pune 410501', 'Maharashtra'], invoiceFormat: 'HFU2/{FY}/{seq}', seqPad: 3, bankName: 'HDFC Bank', accountNo: '50200012345679', ifsc: 'HDFC0000123', active: true },
  { id: 'u3', name: 'Hemant Precision Unit-3', code: 'HPU3', gstin: '27ADGPV9846A3Z4', stateCode: '27', addressLines: ['Plot 7, Bhosari MIDC', 'Pune 411026', 'Maharashtra'], invoiceFormat: 'HPU3/{seq}/{FY}', seqPad: 4, active: true },
]
const ALL_UNIT_IDS = UNITS.map((u) => u.id)

interface RealPart { partNo: string; edition: string; finishKg: number; scrapKg: number }
const REAL_PARTS: RealPart[] = [
  { partNo: 'OM-6308-A-2RS', edition: '3/19 09', finishKg: 0.308, scrapKg: 0.162 },
  { partNo: 'OM-6308-A-2RS-N', edition: '1/22 04', finishKg: 0.302, scrapKg: 0.164 },
  { partNo: 'IM-6308-ALS', edition: '2/19 09', finishKg: 0.188, scrapKg: 0.093 },
  { partNo: 'IM-6309', edition: '7/17 05', finishKg: 0.2354, scrapKg: 0.119 },
  { partNo: 'OM-6309-B-2RS', edition: '9/14 10', finishKg: 0.3938, scrapKg: 0.196 },
  { partNo: 'IM-6310-ALS', edition: '5/14 10', finishKg: 0.3, scrapKg: 0.141 },
  { partNo: 'OM-6310-A-2RS', edition: '11/20 08', finishKg: 0.504, scrapKg: 0.241 },
  { partNo: 'IM-6311', edition: '4/14 10', finishKg: 0.386, scrapKg: 0.161 },
  { partNo: 'OM-6311-2RS', edition: '5/20 08', finishKg: 0.652, scrapKg: 0.268 },
  { partNo: 'IM-6312-A', edition: '4/14 10', finishKg: 0.476, scrapKg: 0.215 },
  { partNo: 'OM-6312-B-2RS', edition: '5/20 08', finishKg: 0.794, scrapKg: 0.324 },
]
const PARTS: Part[] = [
  ...REAL_PARTS.map((rp, i): Part => ({
    id: `p${i + 1}`, partNo: rp.partNo, materialCode: `RM-${String(i + 1).padStart(3, '0')}`,
    description: 'Bearing ring (job-work machining)', editionNo: rp.edition, unitId: 'u1', uom: 'NOS',
    hsnSac: '84829900', gstPct: 12, finishWtMg: mg(rp.finishKg), scrapWtMg: mg(rp.scrapKg),
    avgQtyPerBox: 1050, packingMode: 'GSP-2', active: true,
  })),
  { id: 'p12', partNo: 'DM-1001', materialCode: 'RM-012', description: 'Demo machined hub', unitId: 'u2', uom: 'NOS', hsnSac: '84833000', gstPct: 18, finishWtMg: mg(0.5), scrapWtMg: mg(0.2), avgQtyPerBox: 800, packingMode: 'GSP-1', active: true },
  { id: 'p13', partNo: 'DM-1002', materialCode: 'RM-013', description: 'Demo machined flange', unitId: 'u2', uom: 'NOS', hsnSac: '84833000', gstPct: 18, finishWtMg: mg(0.7), scrapWtMg: mg(0.3), avgQtyPerBox: 600, packingMode: 'GSP-1', active: true },
]

const CUSTOMERS: Customer[] = [
  { id: 'c1', name: 'Rolex Rings Limited', gstin: '24AACCR3790B1ZO', stateCode: '24', addressLines: ['Gondal Road, Nr Railway Crossing', 'Village Kothriya, Rajkot-360004', 'Gujarat'], paymentTermsDays: 45, active: true },
  { id: 'c2', name: 'Yenkay Engineering Pvt Ltd', gstin: '27AABCY1234C1Z8', stateCode: '27', addressLines: ['Plot 14, MIDC Bhosari', 'Pune 411026', 'Maharashtra'], paymentTermsDays: 30, active: true },
  { id: 'c3', name: 'SKF India Ltd', gstin: '29AAACS1234D1Z1', stateCode: '29', addressLines: ['Mahadevapura', 'Bangalore 560048', 'Karnataka'], paymentTermsDays: 30, active: true },
]
const VENDORS: Vendor[] = [
  { id: 'v1', unitId: 'u1', name: 'Sunflag Iron & Steel', code: 'VND-001', type: 'rm', gstin: '27AAACS5678E1Z3', pan: 'AAACS5678E', stateCode: '27', addressLines: ['Bhandara Road', 'Nagpur 441401'], city: 'Nagpur', pincode: '441401', bankName: 'SBI', accountNo: '3012345678', ifsc: 'SBIN0001234', invoiceFormat: 'SUN/{FY}/{seq}', active: true },
  { id: 'v2', unitId: 'u1', name: 'Pune Tool Traders', code: 'VND-002', type: 'service', gstin: '27AAFCP4321F1Z9', stateCode: '27', addressLines: ['Shivajinagar', 'Pune 411005'], active: true },
  { id: 'v3', unitId: 'u1', name: 'Khed Coolants & Oils', code: 'VND-003', type: 'service', stateCode: '27', addressLines: ['Chakan', 'Pune 410501'], active: true },
]

const USERS: User[] = [
  { id: ADMIN, name: 'Hemant V. (Admin)', email: 'admin@hew.in', passwordHash: DEMO_HASH, role: 'admin', assignedUnitIds: ALL_UNIT_IDS, active: true, createdAt: TS },
  { id: 'u-mgr', name: 'Manjiri M. (Manager)', email: 'manager@hew.in', passwordHash: DEMO_HASH, role: 'manager', assignedUnitIds: ['u1', 'u2'], active: true, createdAt: TS },
  { id: 'u-op1', name: 'Operator A', email: 'opa@hew.in', passwordHash: DEMO_HASH, role: 'operator', assignedUnitIds: ['u1'], active: true, createdAt: TS },
  { id: 'u-op2', name: 'Operator B', email: 'opb@hew.in', passwordHash: DEMO_HASH, role: 'operator', assignedUnitIds: ['u2'], active: true, createdAt: TS },
]

const OPENINGS: StockOpening[] = [
  { id: 'so1', unitId: 'u1', partId: 'p6', fy: '24-25', openingQty: 2000, asOfDate: '2024-04-01' },
  { id: 'so2', unitId: 'u1', partId: 'p9', fy: '24-25', openingQty: 1000, asOfDate: '2024-04-01' },
]

function inward(o: Partial<Inward> & Pick<Inward, 'id' | 'partId' | 'challanNo' | 'receivedQty'>): Inward {
  return { unitId: 'u1', customerId: 'c1', challanDate: '2025-01-09', batchHeatNo: '1090465-SUN-55012', vendorId: 'v1', createdBy: ADMIN, createdAt: TS, ...o }
}
function billed(id: string, inwardId: string, okQty: number, billNo: string, rateRs: number, over: Partial<Dispatch> = {}): Dispatch {
  return { id, inwardId, kind: 'billed', okQty, mcRejQty: 0, mfQty: 0, billNo, billDate: '2025-02-07', dispatchDate: '2025-02-02', rateSnapshotPaise: toPaise(rateRs), gstPctSnapshot: 12, createdBy: ADMIN, createdAt: TS, ...over }
}
function rejection(id: string, inwardId: string, mcRejQty: number, billNo: string, over: Partial<Dispatch> = {}): Dispatch {
  return { id, inwardId, kind: 'rejection', okQty: 0, mcRejQty, mfQty: 0, billNo, billDate: '2025-02-08', createdBy: ADMIN, createdAt: TS, ...over }
}

const INWARDS: Inward[] = [
  inward({ id: 'i1', partId: 'p3', challanNo: '8202421273', receivedQty: 28000, poNo: '1190422486' }),
  inward({ id: 'i2', partId: 'p1', challanNo: '8202421270', receivedQty: 4000, batchHeatNo: '1090469-SUN-55012', poNo: '1190422483' }),
  inward({ id: 'i3', partId: 'p1', challanNo: '8202421381', receivedQty: 15000, challanDate: '2025-01-10', batchHeatNo: '1090469-SUN-55012', poNo: '1190422594' }),
  inward({ id: 'i4', partId: 'p6', challanNo: 'ROLEX-IH-1001', receivedQty: 10000, challanDate: '2025-03-01' }),
  inward({ id: 'i5', partId: 'p9', challanNo: 'ROLEX-PR-1002', receivedQty: 8000, challanDate: '2025-03-05' }),
]
const DISPATCHES: Dispatch[] = [
  billed('d1', 'i1', 12020, '255/24-25', 5.1, { dispatchDate: '2025-02-02' }),
  billed('d2', 'i1', 14000, '255/24-25', 5.1, { dispatchDate: '2025-02-04' }),
  rejection('d3', 'i1', 242, 'DC15'),
  billed('d4', 'i1', 1738, '268/24-25', 5.1, { billDate: '2025-03-08', dispatchDate: '2025-03-03' }),
  billed('d5', 'i2', 4000, '254/24-25', 7.95),
  billed('d6', 'i3', 13235, '254/24-25', 7.95),
  billed('d7', 'i3', 1765, '254/24-25', 8.25, { remarks: '2RS-N' }),
  billed('d8', 'i5', 3000, '270/24-25', 9.0, { billDate: '2025-03-08', dispatchDate: '2025-03-06' }),
]

function invoice(billNo: string, seq: number, dispatchIds: string[], lifecycle: Invoice['lifecycle'], date: string): Invoice {
  return { id: `inv-${seq}`, unitId: 'u1', customerId: 'c1', issuerKind: 'unit', issuerId: 'u1', billNo, fy: '24-25', seq, invoiceDate: date, dispatchIds, lifecycle, createdBy: ADMIN, createdAt: TS }
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

const SCRAP: ScrapBill[] = [
  { id: 'sc1', unitId: 'u1', customerId: 'c1', periodFrom: '2023-06-26', periodTo: '2023-07-10', weightGrams: 7_117_000, ratePerKgPaise: toPaise(34.5), gstPct: 18, tcsPct: 1, scrapInvoiceNo: '1202304726', invoiceDate: '2023-07-12', status: 'paid', createdBy: ADMIN, createdAt: TS },
  { id: 'sc2', unitId: 'u1', customerId: 'c1', periodFrom: '2023-07-26', periodTo: '2023-08-10', weightGrams: 12_942_000, ratePerKgPaise: toPaise(33), gstPct: 18, tcsPct: 1, scrapInvoiceNo: '1202306435', invoiceDate: '2023-08-12', status: 'sent', createdBy: ADMIN, createdAt: TS },
]

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
  { id: 'pa1', unitId: 'u1', date: '2025-02-02', shiftNo: 'A', employeeId: 'e1', machineId: 'm1', partId: 'p3', operationId: 'op-1f', openingCounter: 1200, closingCounter: 1250, totalMakeQty: 1200, okQty: 1180, scrapQty: 15, reworkQty: 5, mfQty: 0, downtimeFrom: '13:00', downtimeTo: '13:30', remark: 'Tea + tool change', rateSnapshotPaise: toPaise(2.5), createdBy: ADMIN, createdAt: TS },
]
const SHIFTS: ShiftAttendance[] = [
  { id: 'sh1', unitId: 'u1', date: '2025-02-02', shiftNo: 'A', employeeId: 'e2', fromTime: '09:00', toTime: '17:00', shiftRateSnapshotPaise: toPaise(700), otHours: 1, otRateSnapshotPaise: toPaise(110), createdBy: ADMIN, createdAt: TS },
]

const RM_RATES: RmRate[] = [
  { id: 'rmr1', partId: 'p3', ratePaise: toPaise(58), effectiveFrom: '2024-04-01', supersededAt: '2025-01-01' },
  { id: 'rmr2', partId: 'p3', ratePaise: toPaise(62), effectiveFrom: '2025-01-01' },
  { id: 'rmr3', partId: 'p1', ratePaise: toPaise(64), effectiveFrom: '2024-04-01' },
  { id: 'rmr4', partId: 'p6', ratePaise: toPaise(66), effectiveFrom: '2024-04-01' },
  { id: 'rmr5', partId: 'p9', ratePaise: toPaise(70), effectiveFrom: '2024-04-01' },
]
const PRODUCTION_RATES: ProductionRate[] = [
  { id: 'pr1', partId: 'p3', operationId: 'op-1f', ratePaise: toPaise(2.5), effectiveFrom: '2024-04-01' },
  { id: 'pr2', partId: 'p3', operationId: 'op-1r', ratePaise: toPaise(2.0), effectiveFrom: '2024-04-01' },
  { id: 'pr3', partId: 'p1', operationId: 'op-1f', ratePaise: toPaise(3.0), effectiveFrom: '2024-04-01' },
  { id: 'pr4', partId: 'p6', operationId: 'op-1f', ratePaise: toPaise(2.8), effectiveFrom: '2024-04-01' },
]

const EXPENSES: Expense[] = [
  { id: 'exp1', unitId: 'u1', vendorId: 'v3', vendorName: 'Khed Coolants & Oils', category: 'Consumables', description: 'Cutting oil + coolant (Feb)', date: '2025-02-05', dueDate: '2025-03-07', totalPaise: toPaise(48500), instalments: [{ date: '2025-02-20', amountPaise: toPaise(48500), mode: 'rtgs', ref: 'NEFT-22119' }], createdBy: ADMIN, createdAt: TS },
  { id: 'exp2', unitId: 'u1', category: 'Electricity', description: 'MSEDCL power bill (Feb)', date: '2025-02-10', dueDate: '2025-02-28', totalPaise: toPaise(213400), instalments: [{ date: '2025-02-26', amountPaise: toPaise(100000), mode: 'rtgs', ref: 'UTIB-7781' }], createdBy: ADMIN, createdAt: TS },
  { id: 'exp3', unitId: 'u1', vendorId: 'v2', vendorName: 'Pune Tool Traders', category: 'Tooling', description: 'Carbide inserts + tool holders', date: '2025-02-18', dueDate: '2025-03-20', totalPaise: toPaise(76250), instalments: [], createdBy: ADMIN, createdAt: TS },
]

const REJECTIONS: RejectionAdvice[] = [
  { id: 'rej1', unitId: 'u1', customerId: 'c1', partId: 'p3', sourceInwardId: 'i1', rejDcNo: 'RJ/24-25/01', rejDate: '2025-02-10', mrQty: 242, frQty: 0, weightBasis: 'scrap', weightPerRingMg: 93000, totalWeightGrams: 22506, createdBy: ADMIN, createdAt: TS },
  { id: 'rej2', unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'RJ/24-25/02', rejDate: '2025-02-15', mrQty: 120, frQty: 30, weightBasis: 'scrap', weightPerRingMg: 162000, totalWeightGrams: 24300, createdBy: ADMIN, createdAt: TS },
]

// ── Bulk demo volume (opt-in via SEED_BULK=true) ────────────────────────────────
// Deterministic, index-driven (no RNG) so re-seeds are reproducible. Generates
// enough rows in every list to overflow the 10/25/50/100 page sizes and exercise
// status/filter/date-range edges. Referential integrity is preserved end-to-end:
// inward → dispatch(es) → invoice → payment, plus rejections and HR attendance.
const pad = (n: number, w = 3): string => String(n).padStart(w, '0')
const pick = <T>(arr: readonly T[], i: number): T => arr[i % arr.length]
const CATEGORIES = ['Consumables', 'Electricity', 'Tooling', 'Freight', 'Maintenance', 'Rent', 'Wages', 'Misc']
const PAY_MODES = ['rtgs', 'neft', 'cheque', 'upi', 'cash'] as const

/** Append high-volume demo data to a seeded state. Returns the next invoice seq. */
function bulkSeed(s: RootState): number {
  // Parts — spread across units, GST slabs, with a few inactive (status filter).
  for (let i = 0; i < 57; i++) {
    const unitId = pick(ALL_UNIT_IDS, i)
    const gstPct = i % 3 === 0 ? 18 : 12
    putEntity(s.masters.parts, {
      id: `pb${i}`, partNo: `JW-${6400 + i}-${i % 2 ? '2RS' : 'ALS'}`, materialCode: `RM-${pad(100 + i)}`,
      description: 'Job-work machined component', editionNo: `${(i % 12) + 1}/2${i % 5} 0${(i % 9) + 1}`,
      unitId, uom: 'NOS', hsnSac: gstPct === 18 ? '84833000' : '84829900', gstPct,
      finishWtMg: mg(0.2 + (i % 60) / 100), scrapWtMg: mg(0.1 + (i % 30) / 100),
      avgQtyPerBox: 500 + (i % 8) * 50, packingMode: i % 2 ? 'GSP-1' : 'GSP-2', active: i % 17 !== 0,
    })
  }
  // Customers — varied state codes (intra/inter-state GST), a few inactive.
  const STATES = [['24', 'Gujarat'], ['27', 'Maharashtra'], ['29', 'Karnataka'], ['33', 'Tamil Nadu'], ['09', 'Uttar Pradesh']]
  for (let i = 0; i < 37; i++) {
    const [stateCode, st] = pick(STATES, i)
    putEntity(s.masters.customers, {
      id: `cb${i}`, name: `${pick(['Precision', 'Apex', 'Mahalaxmi', 'Sai', 'Bharat', 'Unique', 'Vidarbha'], i)} ${pick(['Bearings', 'Forgings', 'Auto Components', 'Engineering', 'Industries'], i + 1)} ${i + 1}`,
      gstin: `${stateCode}AABC${pad(i, 4)}Q1Z${i % 9}`, stateCode,
      addressLines: [`Plot ${i + 1}, MIDC`, `${st} ${400000 + i}`], paymentTermsDays: pick([30, 45, 60], i), active: i % 13 !== 0,
    })
  }
  // Vendors — rm/service split, a few inactive.
  for (let i = 0; i < 37; i++) {
    putEntity(s.masters.vendors, {
      id: `vb${i}`, name: `${pick(['Sunrise', 'Metro', 'Pune', 'Nagpur', 'Krishna', 'Global'], i)} ${pick(['Steel', 'Tools', 'Coolants', 'Logistics', 'Traders'], i + 1)} ${i + 1}`,
      unitId: pick(ALL_UNIT_IDS, i), code: `VND-${pad(100 + i)}`, type: i % 2 ? 'service' : 'rm', stateCode: '27',
      addressLines: [`Gala ${i + 1}, Bhosari`, `Pune ${411000 + i}`], city: 'Pune', active: i % 11 !== 0,
    })
  }
  // Machines / operations / employees — feed Attendance & Payroll.
  for (let i = 0; i < 18; i++) putEntity(s.masters.machines, { id: `mb${i}`, machineNo: `MC-${pad(10 + i, 2)}`, description: pick(['CNC Turning', 'VMC', 'Grinding', 'Drilling'], i), unitId: pick(ALL_UNIT_IDS, i), active: i % 9 !== 0 })
  for (let i = 0; i < 10; i++) putEntity(s.masters.operations, { id: `opb${i}`, code: `${(i % 4) + 2}${i % 2 ? 'F' : 'R'}`, description: pick(['Rough', 'Finish', 'Bore', 'Face'], i), active: true })
  for (let i = 0; i < 58; i++) putEntity(s.masters.employees, { id: `eb${i}`, name: `${pick(['Ramesh', 'Suresh', 'Mahesh', 'Dinesh', 'Ganesh', 'Vijay', 'Anil', 'Sunil'], i)} ${pick(['Patil', 'Jadhav', 'Kale', 'More', 'Shinde', 'Pawar'], i + 1)}`, empCode: `E${pad(100 + i)}`, phone: `98${pad(10000000 + i, 8)}`, labourType: pick(['production', 'shift', 'both'] as const, i), standardShiftRatePaise: toPaise(600 + (i % 6) * 50), unitId: pick(ALL_UNIT_IDS, i), active: i % 14 !== 0 })

  // Expenses — categories, optional vendor, mixed paid/partial/unpaid via instalments.
  for (let i = 0; i < 77; i++) {
    const total = 20000 + (i % 25) * 6500
    const paid = i % 3 === 0 ? 0 : i % 3 === 1 ? Math.round(total * 0.5) : total
    putEntity(s.expenses.expenses, {
      id: `expb${i}`, unitId: pick(ALL_UNIT_IDS, i), vendorId: i % 4 ? `vb${i % 37}` : undefined,
      vendorName: i % 4 ? undefined : pick(['MSEDCL', 'Cash purchase', 'Local supplier'], i), category: pick(CATEGORIES, i),
      description: `${pick(CATEGORIES, i)} — ${pick(['Jan', 'Feb', 'Mar', 'Apr', 'Nov', 'Dec'], i)}`,
      date: `2025-${pad((i % 3) + 1, 2)}-${pad((i % 27) + 1, 2)}`, dueDate: `2025-${pad((i % 3) + 2, 2)}-${pad((i % 27) + 1, 2)}`,
      totalPaise: toPaise(total),
      instalments: paid > 0 ? [{ date: `2025-${pad((i % 3) + 2, 2)}-${pad((i % 20) + 1, 2)}`, amountPaise: toPaise(paid), mode: pick(PAY_MODES, i), ref: `PAY-${20000 + i}` }] : [],
      createdBy: ADMIN, createdAt: TS,
    })
  }

  // Scrap bills — periods + statuses.
  const custIds = values(s.masters.customers).map((c) => c.id)
  for (let i = 0; i < 28; i++) {
    putEntity(s.scrap.scrapBills, {
      id: `scb${i}`, unitId: pick(ALL_UNIT_IDS, i), customerId: pick(custIds, i),
      periodFrom: `2024-${pad((i % 11) + 1, 2)}-01`, periodTo: `2024-${pad((i % 11) + 1, 2)}-15`,
      weightGrams: 3_000_000 + i * 250_000, ratePerKgPaise: toPaise(30 + (i % 8)), gstPct: 18, tcsPct: 1,
      scrapInvoiceNo: `120240${pad(1000 + i, 4)}`, invoiceDate: `2024-${pad((i % 11) + 1, 2)}-16`,
      status: pick(['draft', 'sent', 'paid', 'partial'] as const, i), createdBy: ADMIN, createdAt: TS,
    })
  }

  // Transactional chain: inward → dispatch(es) → invoice → payment (+ rejections).
  const partsByUnit: Record<string, string[]> = { u1: [], u2: [], u3: [] }
  for (const p of values(s.masters.parts)) (partsByUnit[p.unitId] ||= []).push(p.id)
  const MONTHS = ['2025-01', '2025-02', '2025-03', '2024-11', '2024-12']
  let seq = 300
  for (let i = 0; i < 115; i++) {
    const unitId = i % 3 === 0 ? 'u2' : 'u1'
    const pool = partsByUnit[unitId].length ? partsByUnit[unitId] : partsByUnit.u1
    const partId = pick(pool, i)
    const customerId = pick(custIds, i)
    const recv = 2000 + (i % 20) * 1500
    const mm = pick(MONTHS, i)
    const day = pad((i % 27) + 1, 2)
    const date = `${mm}-${day}`
    const inwId = `ib${i}`
    putEntity(s.inventory.inwards, inward({
      id: inwId, partId, challanNo: `CH-${90000 + i}`, receivedQty: recv, unitId, customerId,
      challanDate: date, batchHeatNo: `${1090000 + i}-SUN-${55000 + i}`, poNo: `${1190000 + i}`,
    }))
    const part = getById(s.masters.parts, partId)
    const gst = part?.gstPct ?? 12
    const rate = 4 + (i % 10) * 0.5
    const mode = i % 6
    if (mode === 0) continue // in-house: no dispatch
    const ok = mode === 1 ? Math.floor(recv * 0.6) : recv // partial vs full
    const dId = `db${i}`
    putEntity(s.inventory.dispatches, billed(dId, inwId, ok, `${seq}/24-25`, rate, { gstPctSnapshot: gst, billDate: date, dispatchDate: date }))
    if (mode === 5) putEntity(s.inventory.dispatches, rejection(`dr${i}`, inwId, 100 + (i % 50), `DC-${i}`)) // dispatched + rejection
    const lifecycle: Invoice['lifecycle'] = i % 9 === 0 ? 'draft' : i % 23 === 0 ? 'void' : 'sent'
    putEntity(s.billing.invoices, {
      id: `invb${seq}`, unitId, customerId, issuerKind: 'unit', issuerId: unitId, billNo: `${seq}/24-25`,
      fy: '24-25', seq, invoiceDate: date, dispatchIds: [dId], lifecycle, createdBy: ADMIN, createdAt: TS,
    })
    // Payment for ~half of the non-draft invoices (mix of full/partial → receivables edges).
    if (lifecycle === 'sent' && i % 2 === 0) {
      const roughRs = ok * rate * (1 + gst / 100)
      const amountPaise = toPaise(Math.round((i % 4 === 0 ? roughRs * 0.6 : roughRs) * 100) / 100)
      putEntity(s.payments.payments, { id: `payb${i}`, mode: pick(PAY_MODES, i), ref: `${18000000 + i}`, date, amountPaise, allocations: [{ invoiceId: `invb${seq}`, amountPaise }] })
    }
    seq++
  }

  // Rejection advices.
  const inwardIds = values(s.inventory.inwards).map((x) => x.id)
  for (let i = 0; i < 38; i++) {
    const srcId = pick(inwardIds, i)
    const src = getById(s.inventory.inwards, srcId)
    if (!src) continue
    putEntity(s.rejection.rejectionAdvices, {
      id: `rejb${i}`, unitId: src.unitId, customerId: src.customerId, partId: src.partId, sourceInwardId: srcId,
      rejDcNo: `RJ/24-25/${pad(100 + i)}`, rejDate: `2025-${pad((i % 3) + 1, 2)}-${pad((i % 27) + 1, 2)}`,
      mrQty: 50 + (i % 200), frQty: i % 4 === 0 ? 20 + (i % 30) : 0, weightBasis: i % 2 ? 'finish' : 'scrap',
      weightPerRingMg: 93000 + (i % 5) * 10000, totalWeightGrams: 10000 + i * 350, createdBy: ADMIN, createdAt: TS,
    })
  }

  // HR — production + shift attendance.
  const empIds = values(s.masters.employees).map((e) => e.id)
  const machIds = values(s.masters.machines).map((m) => m.id)
  const opIds = values(s.masters.operations).map((o) => o.id)
  for (let i = 0; i < 119; i++) {
    const unitId = pick(ALL_UNIT_IDS, i)
    const make = 1000 + (i % 30) * 25
    const scrapQ = i % 20
    const okQ = make - scrapQ - (i % 7)
    putEntity(s.hr.production, {
      id: `pab${i}`, unitId, date: `2025-${pad((i % 3) + 1, 2)}-${pad((i % 27) + 1, 2)}`, shiftNo: pick(['A', 'B', 'C'], i),
      employeeId: pick(empIds, i), machineId: pick(machIds, i), partId: pick(partsByUnit[unitId].length ? partsByUnit[unitId] : partsByUnit.u1, i),
      operationId: pick(opIds, i), openingCounter: i * 50, closingCounter: i * 50 + make, totalMakeQty: make,
      okQty: okQ, scrapQty: scrapQ, reworkQty: i % 5, mfQty: i % 9, rateSnapshotPaise: toPaise(2 + (i % 4) * 0.5), createdBy: ADMIN, createdAt: TS,
    })
    putEntity(s.hr.shifts, {
      id: `shb${i}`, unitId, date: `2025-${pad((i % 3) + 1, 2)}-${pad((i % 27) + 1, 2)}`, shiftNo: pick(['A', 'B', 'C'], i),
      employeeId: pick(empIds, i + 1), fromTime: '09:00', toTime: '17:00', shiftRateSnapshotPaise: toPaise(650 + (i % 5) * 40),
      otHours: i % 3, otRateSnapshotPaise: toPaise(100 + (i % 4) * 10), createdBy: ADMIN, createdAt: TS,
    })
  }

  // RM + production rate cards for a slice of the new parts.
  for (let i = 0; i < 30; i++) {
    putEntity(s.masters.rmRates, { id: `rmrb${i}`, partId: `pb${i}`, ratePaise: toPaise(55 + (i % 20)), effectiveFrom: '2024-04-01' })
    putEntity(s.masters.productionRates, { id: `prb${i}`, partId: `pb${i}`, operationId: pick(opIds, i), ratePaise: toPaise(2 + (i % 6) * 0.4), effectiveFrom: '2024-04-01' })
  }

  return seq
}

/** Build a fully-seeded RootState (deterministic). Invoice totals are computed lazily by the billing module. */
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
  // Opt-in bulk volume for pagination/QA — must run before the freeze loop below.
  const bulkNextSeq = process.env.SEED_BULK === 'true' ? bulkSeed(s) : 271
  // Freeze totals/taxKind/packing onto every NON-draft invoice (mirrors finalizeInvoice)
  // so the billing/receivables/payments reads show real money instead of ₹0.
  for (const inv of values(s.billing.invoices)) {
    if (inv.lifecycle === 'draft') continue
    const unit = getById(s.masters.units, inv.unitId)
    const cust = getById(s.masters.customers, inv.customerId)
    const taxKind = deriveTaxKind(unit?.stateCode, cust?.stateCode)
    const c = computeInvoice(s, inv, taxKind)
    putEntity(s.billing.invoices, { ...inv, taxKind, totals: c.totals, packing: c.packing })
  }
  s.system.sequences = { 'u1:24-25': bulkNextSeq }
  s.system.seeded = true
  s.system.seedVersion = SEED_VERSION
  return s
}

/**
 * Minimal production bootstrap for an EMPTY database: the HEW unit + RBAC roles +
 * a single admin from env (NO demo business data, NO `demo`-password accounts).
 * The admin then edits the unit and imports/enters real data.
 */
export function bootstrapState(opts: { adminEmail: string; adminPassword: string }): RootState {
  const s = createEmptyState()
  const hew = UNITS[0] // the real Hemant Engineering Works unit
  putEntity(s.masters.units, hew)
  seedRoleDefs().forEach((r) => putEntity(s.masters.roles, r))
  putEntity(s.masters.users, {
    id: ADMIN,
    name: 'Administrator',
    email: opts.adminEmail.toLowerCase(),
    passwordHash: bcrypt.hashSync(opts.adminPassword, 10),
    role: 'admin',
    assignedUnitIds: [hew.id],
    active: true,
    createdAt: TS,
  })
  s.system.seeded = true
  s.system.seedVersion = SEED_VERSION
  return s
}
