/**
 * Hydrate the local Zustand store from the backend so every page renders real
 * API data with no per-page rewrite. GET /system/backup returns the full
 * RootState (minus session/undo); a shallow top-level merge keeps the session.
 */
import { api } from './client'
import { mastersApi } from './modules'
import { getStateVersion, setStateVersion } from './stateVersion'
import { useStore } from '@/store'
import type { RootState } from '@/store/state'
import type { Id, Normalized } from '@/types/domain'

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
export async function hydrateViaModules(): Promise<void> {
  const list = <T>(p: string) => api.get<T[]>(p)
  const [
    units, users, roles, customers, vendors, parts, stockOpenings, machines, operations, employees,
    rmRates, productionRates, inwardRows, dispatches, invoiceRows, payments, scrapBills, expenses,
    rejectionAdvices, productionRows, shiftRows,
  ] = await Promise.all([
    mastersApi.list<any>('units'), list<any>('/users'), list<any>('/roles'),
    mastersApi.list<any>('customers'), mastersApi.list<any>('vendors'), mastersApi.list<any>('parts'),
    mastersApi.list<any>('stock-openings'), mastersApi.list<any>('machines'),
    mastersApi.list<any>('operations'), mastersApi.list<any>('employees'),
    list<any>('/rates/rm'), list<any>('/rates/production'),
    list<any>('/inward'), list<any>('/dispatch'), list<any>('/invoices'), list<any>('/payments'),
    list<any>('/scrap'), list<any>('/expenses'), list<any>('/rejection'),
    list<any>('/attendance/production'), list<any>('/attendance/shift'),
  ]) // eslint-disable-line @typescript-eslint/no-explicit-any

  const s = useStore.getState()
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
    system: s.system,
  } as Partial<RootState>)
}
