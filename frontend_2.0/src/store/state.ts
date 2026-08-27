/**
 * RootState — one normalized store, sliced by domain. Held separately from
 * the store factory (index.ts) so selectors/scope/commandBus can import the
 * shape without a cycle. Derived values are NEVER stored here.
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
  Session,
  SequenceCounters,
  ShiftAttendance,
  StockOpening,
  StockSnapshot,
  UndoRecord,
  Unit,
  User,
  Vendor,
} from '@/types/domain'
import type { RoleDef } from '@/types/rbac'
import { emptyCollection } from './normalized'

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
    /** Demo-dataset version — lets an already-seeded store pick up new demo
     *  collections added in later builds without a manual reset (see store merge). */
    seedVersion: number
  }
  /** Not persisted. */
  session: Session
  /** Not persisted — in-memory undo/redo stacks. */
  _undo: UndoRecord[]
  _redo: UndoRecord[]
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
    session: { currentUserId: null, currentUnitId: null },
    _undo: [],
    _redo: [],
  }
}

/** The persisted subset — excludes session and the undo/redo stacks. */
export type PersistedState = Omit<RootState, 'session' | '_undo' | '_redo'>

export function pickPersisted(s: RootState): PersistedState {
  const { session: _session, _undo, _redo, ...rest } = s
  void _session
  void _undo
  void _redo
  return rest
}
