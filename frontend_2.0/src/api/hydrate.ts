/**
 * Hydrate the local Zustand store from the backend so every page renders real
 * API data with no per-page rewrite. GET /system/backup returns the full
 * RootState (minus session/undo); a shallow top-level merge keeps the session.
 */
import { api } from './client'
import type { ApiUser } from './auth'
import { mastersApi } from './modules'
import { getStateVersion, setStateVersion } from './stateVersion'
import { useStore } from '@/store'
import type { RootState } from '@/store/state'
import { currentUser } from '@/store'
import { can, BUILTIN_ROLE_IDS, type RoleDef } from '@/types/rbac'
import type {
  Customer, Dispatch, Employee, Expense, Id, Inward, Invoice, Machine, Normalized,
  Operation, Part, Payment, ProductionAttendance, ProductionRate, RejectionAdvice,
  RmRate, ScrapBill, ShiftAttendance, StockOpening, Unit, User, Vendor,
} from '@/types/domain'

type PersistedSlices = Omit<RootState, 'session' | '_undo' | '_redo'>

// Re-exported for existing importers; the version is now tracked centrally from the
// X-State-Version response header (see stateVersion.ts + client.ts).
export { getStateVersion, setStateVersion }

/**
 * Admin hydration — the full raw book in one shot via /system/backup (includes the
 * `system` slice: sequences, schema/seed flags) plus the state version. Admin-only.
 */
export async function hydrateStoreFromApi(): Promise<void> {
  const res = await api.raw<{ data: PersistedSlices; version: number }>('/system/backup')
  // Top-level shallow merge: replaces masters/inventory/billing/… and leaves
  // session + _undo/_redo (which the server doesn't own) untouched.
  useStore.setState(res.data as Partial<RootState>)
  setStateVersion(res.version ?? 0) // also tracked via the response header
}

/** Normalize an array of entities into the store's { byId, allIds } shape. */
function norm<T extends { id: Id }>(rows: T[]): Normalized<T> {
  const byId: Record<Id, T> = {}
  const allIds: Id[] = []
  for (const e of rows) {
    if (!e || e.id == null) continue
    byId[e.id] = e
    allIds.push(e.id)
  }
  return { byId, allIds }
}

/**
 * Per-role hydration via the MODULE GET endpoints (scoped to the caller's units,
 * available to every role). Assembles the normalized store from the module APIs —
 * this is what lets operators/managers see real backend data (the /system/backup
 * snapshot is admin-only) and makes the live app exercise the read endpoints.
 *
 * The `system` slice (sequences/flags) is intentionally left as-is: module GETs
 * don't expose it, and invoice numbering for non-admin writes is assigned
 * server-side by the finalize endpoint.
 */
function apiUserAsStoreUser(user: ApiUser): User {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    assignedUnitIds: user.assignedUnitIds,
    active: user.active,
    createdAt: user.createdAt,
  }
}

function apiUserRole(user: ApiUser): RoleDef {
  return {
    id: user.role,
    name: user.role,
    builtIn: BUILTIN_ROLE_IDS.includes(user.role as (typeof BUILTIN_ROLE_IDS)[number]),
    permissions: user.permissions,
  }
}

interface InwardRow { inward: Inward }
interface InvoiceRow { invoice: Invoice }
interface ProductionRow { entry: ProductionAttendance }
interface ShiftRow { entry: ShiftAttendance }

export async function hydrateViaModules(authenticatedUser?: ApiUser): Promise<void> {
  const list = <T>(p: string) => api.get<T[]>(p)
  const previous = useStore.getState()
  const actor = currentUser(previous)
  const mayViewUsers = authenticatedUser
    ? authenticatedUser.permissions.users?.includes('view') === true
    : can(actor, 'users', 'view')
  const [
    units, customers, vendors, parts, stockOpenings, machines, operations, employees,
    rmRates, productionRates, inwardRows, dispatches, invoiceRows, payments, scrapBills, expenses,
    rejectionAdvices, productionRows, shiftRows,
  ] = await Promise.all([
    mastersApi.list<Unit>('units'), mastersApi.list<Customer>('customers'), mastersApi.list<Vendor>('vendors'),
    mastersApi.list<Part>('parts'), mastersApi.list<StockOpening>('stock-openings'), mastersApi.list<Machine>('machines'),
    mastersApi.list<Operation>('operations'), mastersApi.list<Employee>('employees'),
    list<RmRate>('/rates/rm'), list<ProductionRate>('/rates/production'),
    list<InwardRow>('/inward'), list<Dispatch>('/dispatch'), list<InvoiceRow>('/invoices'), list<Payment>('/payments'),
    list<ScrapBill>('/scrap'), list<Expense>('/expenses'), list<RejectionAdvice>('/rejection'),
    list<ProductionRow>('/attendance/production'), list<ShiftRow>('/attendance/shift'),
  ])

  let users: User[]
  let roles: RoleDef[]
  if (mayViewUsers) {
    const [loadedUsers, loadedRoles] = await Promise.all([list<User>('/users'), list<RoleDef>('/roles')])
    users = loadedUsers
    roles = loadedRoles
  } else if (authenticatedUser) {
    users = [apiUserAsStoreUser(authenticatedUser)]
    roles = [apiUserRole(authenticatedUser)]
  } else {
    users = actor ? [actor] : []
    roles = actor ? previous.masters.roles.allIds.map((id) => previous.masters.roles.byId[id]!).filter((r) => r.id === actor.role) : []
  }

  useStore.setState({
    masters: {
      units: norm(units), users: norm(users), roles: norm(roles), customers: norm(customers),
      vendors: norm(vendors), parts: norm(parts), stockOpenings: norm(stockOpenings),
      rmRates: norm(rmRates), productionRates: norm(productionRates), machines: norm(machines),
      operations: norm(operations), employees: norm(employees),
    },
    inventory: { inwards: norm(inwardRows.map((r) => r.inward)), dispatches: norm(dispatches) },
    billing: { invoices: norm(invoiceRows.map((r) => r.invoice)) },
    payments: { payments: norm(payments) },
    scrap: { scrapBills: norm(scrapBills) },
    expenses: { expenses: norm(expenses) },
    rejection: { rejectionAdvices: norm(rejectionAdvices) },
    hr: { production: norm(productionRows.map((r) => r.entry)), shifts: norm(shiftRows.map((r) => r.entry)) },
    // Keep the local system slice (sequences/flags) — module GETs don't expose it.
    system: previous.system,
  } as Partial<RootState>)
}
