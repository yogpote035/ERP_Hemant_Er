/**
 * RootState — the server's normalized document, mirroring the frontend store so
 * ported selectors/commands work unchanged. Persisted whole to a JSON file.
 */
import type {
  ActivityLogEntry,
  Customer,
  Dispatch,
  Employee,
  Expense,
  Inward,
  Invoice,
  Machine,
  Normalized,
  Operation,
  Part,
  Payment,
  ProductionAttendance,
  ProductionRate,
  RejectionAdvice,
  RmRate,
  ScrapBill,
  SequenceCounters,
  ShiftAttendance,
  StockOpening,
  StockSnapshot,
  Unit,
  User,
  Vendor,
} from '../types/domain.js'
import type { RoleDef } from '../types/rbac.js'
import { emptyCollection } from './normalized.js'

export const SCHEMA_VERSION = 1

export interface RootState {
  masters: {
    units: Normalized<Unit>
    users: Normalized<User>
    roles: Normalized<RoleDef>
    customers: Normalized<Customer>
    vendors: Normalized<Vendor>
    parts: Normalized<Part>
    stockOpenings: Normalized<StockOpening>
    rmRates: Normalized<RmRate>
    productionRates: Normalized<ProductionRate>
    machines: Normalized<Machine>
    operations: Normalized<Operation>
    employees: Normalized<Employee>
  }
  inventory: {
    inwards: Normalized<Inward>
    dispatches: Normalized<Dispatch>
  }
  billing: { invoices: Normalized<Invoice> }
  payments: { payments: Normalized<Payment> }
  scrap: { scrapBills: Normalized<ScrapBill> }
  expenses: { expenses: Normalized<Expense> }
  rejection: { rejectionAdvices: Normalized<RejectionAdvice> }
  hr: {
    production: Normalized<ProductionAttendance>
    shifts: Normalized<ShiftAttendance>
  }
  system: {
    sequences: SequenceCounters
    activityLog: ActivityLogEntry[]
    stockSnapshots: Normalized<StockSnapshot>
    schemaVersion: number
    seeded: boolean
    seedVersion: number
  }
}

export function createEmptyState(): RootState {
  return {
    masters: {
      units: emptyCollection(),
      users: emptyCollection(),
      roles: emptyCollection(),
      customers: emptyCollection(),
      vendors: emptyCollection(),
      parts: emptyCollection(),
      stockOpenings: emptyCollection(),
      rmRates: emptyCollection(),
      productionRates: emptyCollection(),
      machines: emptyCollection(),
      operations: emptyCollection(),
      employees: emptyCollection(),
    },
    inventory: { inwards: emptyCollection(), dispatches: emptyCollection() },
    billing: { invoices: emptyCollection() },
    payments: { payments: emptyCollection() },
    scrap: { scrapBills: emptyCollection() },
    expenses: { expenses: emptyCollection() },
    rejection: { rejectionAdvices: emptyCollection() },
    hr: { production: emptyCollection(), shifts: emptyCollection() },
    system: {
      sequences: {},
      activityLog: [],
      stockSnapshots: emptyCollection(),
      schemaVersion: SCHEMA_VERSION,
      seeded: false,
      seedVersion: 0,
    },
  }
}
