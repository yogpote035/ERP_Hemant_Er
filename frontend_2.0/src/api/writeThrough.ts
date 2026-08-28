/**
 * Write-through: mirror every successful local command to the backend (API mode),
 * calling each MODULE's endpoint at its module — for EVERY role, admin included.
 *
 * - Mapped commands → their module endpoint (POST /inward, /payments, /masters/:entity, …).
 * - undo / redo, and the few unmapped commands (e.g. importMioWorkbook) → an admin-only
 *   full-state snapshot to POST /system/backup (its real role: backup/restore + the
 *   catch-all that keeps undo in sync). Non-admins get a "saved locally" notice there.
 *
 * Installed once after an API login; a no-op in local mode.
 */
import { toast } from 'sonner'
import { useStore, currentUser } from '@/store'
import { setWriteSyncHook } from '@/store/commandBus'
import type { CommandName } from '@/store/commands'
import type { Module } from '@/types/rbac'
import {
  mastersApi, inwardApi, dispatchApi, invoicesApi, paymentsApi,
  scrapApi, expensesApi, rejectionApi, attendanceApi, ratesApi, usersApi, rolesApi, systemApi, importApi,
} from './modules'
import { ApiError } from './client'
import { getStateVersion } from './stateVersion'
import { hydrateViaModules } from './hydrate'
import { refreshAllData } from './refresh'

let installed = false

export function installWriteThrough(): void {
  if (installed) return
  installed = true
  setWriteSyncHook((name, input, result, ctx) => {
    void sync(name, input, result, ctx.module)
  })
}

// ── full-state snapshot (undo + unmapped commands; admin only) ───────────────
let syncing = false
let dirty = false
async function pushFullState(): Promise<void> {
  if (syncing) { dirty = true; return }
  syncing = true
  try {
    do {
      dirty = false
      const { session: _s, _undo, _redo, ...persisted } = useStore.getState()
      void _s; void _undo; void _redo
      // Send the version our state is based on. The client tracks it from every
      // response header, so this is current w.r.t. OUR own writes — a 409 means
      // ANOTHER session advanced the state, which we must not clobber.
      await systemApi.restore(persisted, getStateVersion())
    } while (dirty)
  } catch (e) {
    if (e instanceof ApiError && e.status === 409) {
      // Conflict: re-hydrate so the other session's write wins (no clobber). The
      // local undo/redo stacks were recorded against the now-replaced tree.
      try {
        await hydrateViaModules()
        useStore.setState({ _undo: [], _redo: [] })
      } catch {
        /* keep local state if the re-hydrate also fails */
      }
      toast.warning('Another session changed data — reloaded the latest; re-apply your change if needed.')
    } else {
      toast.warning('Backend sync failed — changes saved locally.')
    }
  } finally {
    syncing = false
  }
}

// ── non-admin: per-command module endpoints ──────────────────────────────────
/* eslint-disable @typescript-eslint/no-explicit-any */
type Handler = (input: any, result: any, module: Module) => Promise<unknown>
const isNew = (i: { id?: string }) => !i?.id
const idOf = (i: any, r: any): string => i?.id ?? r?.id

/** Master id-prefix → { store collection, backend entity segment }. */
const MASTER_REF: Record<string, { coll: string; entity: string }> = {
  unit: { coll: 'units', entity: 'units' },
  cus: { coll: 'customers', entity: 'customers' },
  vnd: { coll: 'vendors', entity: 'vendors' },
  part: { coll: 'parts', entity: 'parts' },
  mch: { coll: 'machines', entity: 'machines' },
  op: { coll: 'operations', entity: 'operations' },
  emp: { coll: 'employees', entity: 'employees' },
  open: { coll: 'stockOpenings', entity: 'stock-openings' },
}
const prefixOf = (id: string) => id.split(/[-_]/)[0] ?? ''
const ALL_REFS = Object.values(MASTER_REF)
/** Resolve {coll, entity} for a master id. Newly-created ids carry a prefix
 *  (`part_…`, `cus_…`); seeded/server-authoritative ids (`p1`, `c1`, `pb0`) don't,
 *  so fall back to locating the master collection that actually holds the id. */
const refFromId = (id: string) => MASTER_REF[prefixOf(id)] ?? ALL_REFS.find((ref) => storedEntity(ref.coll, id))
/** Read the canonical stored entity (backend-shaped) by id from a store collection. */
function storedEntity(coll: string, id: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  const masters = useStore.getState().masters as Record<string, { byId: Record<string, unknown> }>
  return masters[coll]?.byId[id]
}

/** saveMaster carries { values, existingId }; the stored entity is the source of truth to sync. */
function syncMaster(input: { existingId?: string | null; values?: unknown; id?: string }, result: { id?: string }): Promise<unknown> {
  // The `activate` (reactivate) command reuses name 'saveMaster' but passes only { id }
  // (no `values`). It's an EDIT — route it through PATCH /active, not a create.
  if (input.values === undefined && input.id) {
    const ref = refFromId(input.id)
    return ref ? mastersApi.setActive(ref.entity, input.id, true) : skip('This master')
  }
  const id = input.existingId ?? result?.id
  if (!id) return Promise.resolve()
  const prefix = prefixOf(id)
  // Versioned rate masters use the dedicated /rates endpoints (create-only).
  if (prefix === 'rm' || prefix === 'pr') {
    if (input.existingId) return skip('Editing a rate') // rates are append-only versions
    const r = storedEntity(prefix === 'rm' ? 'rmRates' : 'productionRates', id)
    if (!r) return Promise.resolve()
    return prefix === 'rm'
      ? ratesApi.createRm({ partId: r.partId, ratePaise: r.ratePaise, effectiveFrom: r.effectiveFrom })
      : ratesApi.createProduction({ partId: r.partId, machineId: r.machineId, operationId: r.operationId, ratePaise: r.ratePaise, effectiveFrom: r.effectiveFrom })
  }
  const ref = refFromId(id)
  if (!ref) return skip('This master')
  const entity = storedEntity(ref.coll, id)
  if (!entity) return Promise.resolve()
  return input.existingId ? mastersApi.update(ref.entity, id, entity) : mastersApi.create(ref.entity, entity)
}

// On CREATE, send the local command's id so the server adopts it (no id divergence,
// so a later edit/delete by the same non-admin session targets the right row).
const withId = (i: any, r: any) => ({ ...i, id: idOf(i, r) }) // eslint-disable-line @typescript-eslint/no-explicit-any
// saveOutwardDispatch is single (input=line, result={id}) OR batch (input={inwardId,lines},
// result={ids}). Inject the locally-minted id(s) so the backend adopts them rather than
// minting its own (which would 404 a later edit/delete by the local id). The backend's
// lineSchema accepts `id` and applyLine honours it for both shapes.
const withDispatchIds = (i: any, r: any) => // eslint-disable-line @typescript-eslint/no-explicit-any
  Array.isArray(i?.lines)
    ? { ...i, lines: i.lines.map((ln: any, idx: number) => ({ ...ln, id: ln.id ?? r?.ids?.[idx] })) } // eslint-disable-line @typescript-eslint/no-explicit-any
    : { ...i, id: i?.id ?? r?.id }

const MODULE_SYNC: Partial<Record<CommandName, Handler>> = {
  saveInward: (i, r) => (isNew(i) ? inwardApi.create(withId(i, r)) : inwardApi.update(i.id, i)),
  saveOutwardDispatch: (i, r) => dispatchApi.create(withDispatchIds(i, r)), // adopt local id(s); POST handles create + edit
  // deleteEntity is shared by inward, dispatch and the masters framework — route by module.
  deleteEntity: (i, _r, module) => {
    if (module === 'inward') return inwardApi.remove(i.id)
    if (module === 'dispatch') return dispatchApi.remove(i.id)
    if (module === 'masters') {
      const ref = refFromId(i.id)
      return ref ? mastersApi.remove(ref.entity, i.id) : skip('This master')
    }
    return skip('This change')
  },
  saveMaster: (i, r) => syncMaster(i, r),
  finalizeInvoice: (i) => {
    const inv = storedInvoice(i.invoiceId)
    return invoicesApi.finalize({ ...i, unitId: inv?.unitId, billNo: inv?.billNo })
  },
  editDraftInvoice: (i) => {
    const inv = storedInvoice(i.invoiceId)
    return invoicesApi.editDraft(i.invoiceId, { customerId: i.customerId, issuerKind: i.issuerKind, issuerVendorId: i.issuerVendorId, invoiceDate: i.invoiceDate, paymentTerms: i.paymentTerms, ewayBillNo: i.ewayBillNo, vehicleNo: i.vehicleNo, transporter: i.transporter, dispatchedThrough: i.dispatchedThrough, destination: i.destination, unitId: inv?.unitId, billNo: inv?.billNo })
  },
  voidInvoice: (i, r) => invoicesApi.void(idOf(i, r)),
  recordPayment: (i, r) => paymentsApi.record(withId(i, r)),
  reversePayment: (i, r) => paymentsApi.reverse(idOf(i, r)),
  saveScrapBill: (i, r) => (isNew(i) ? scrapApi.create(withId(i, r)) : scrapApi.update(i.id, i)),
  deleteScrapBill: (i, r) => scrapApi.remove(idOf(i, r)),
  saveExpense: (i, r) => (isNew(i) ? expensesApi.create(withId(i, r)) : expensesApi.update(i.id, i)),
  recordExpensePayment: (i) => expensesApi.pay(i.expenseId, { date: i.date, amountPaise: i.amountPaise, mode: i.mode, ref: i.ref }),
  deleteExpense: (i, r) => expensesApi.remove(idOf(i, r)),
  saveRejectionAdvice: (i, r) => (isNew(i) ? rejectionApi.create(withId(i, r)) : rejectionApi.update(i.id, i)),
  deleteRejectionAdvice: (i, r) => rejectionApi.remove(idOf(i, r)),
  // Attendance (operators use this) — POST upserts by id, so create + edit both POST.
  saveProductionAttendance: (i, r) => attendanceApi.createProduction(withId(i, r)),
  deleteProductionAttendance: (i, r) => attendanceApi.removeProduction(idOf(i, r)),
  saveShiftAttendance: (i, r) => attendanceApi.createShift(withId(i, r)),
  deleteShiftAttendance: (i, r) => attendanceApi.removeShift(idOf(i, r)),
  // Users (admin only).
  createUser: (i, r) => usersApi.create({ id: idOf(i, r), name: i.name, email: i.email, password: i.password ?? 'demo', role: i.role, assignedUnitIds: i.assignedUnitIds, active: i.active ?? true }),
  updateUser: (i) => usersApi.update(i.id, { name: i.name, email: i.email, role: i.role, assignedUnitIds: i.assignedUnitIds }),
  toggleUserActive: (i, r) => usersApi.setActive(idOf(i, r), !!r?.active),
  setUserOverride: (i) => usersApi.setOverride(i.id, { add: i.overrides?.add ?? {}, remove: i.overrides?.remove ?? {} }),
  // Roles (admin only) — send the canonical stored role for create.
  createRole: (i, r) => {
    const role = storedEntity('roles', idOf(i, r))
    if (!role) {
      toast.warning('Could not sync the new role to the server — reload and try again.')
      return Promise.resolve()
    }
    return rolesApi.create({ id: idOf(i, r), name: role.name, description: role.description, permissions: role.permissions })
  },
  updateRolePermissions: (i) => rolesApi.updatePermissions(i.id, { permissions: i.permissions }),
  renameRole: (i) => rolesApi.rename(i.id, { name: i.name, description: i.description }),
  deleteRole: (i, r) => rolesApi.remove(idOf(i, r)),
  resetRole: (i, r) => rolesApi.reset(idOf(i, r)),
  // MIO workbook import — apply server-side (managers have import:create) instead of
  // the old admin-only snapshot, then re-hydrate so the locally-created entities
  // (minted with client ids) converge to the server's. Closes the manager data-loss gap.
  importMioWorkbook: async (i) => {
    await importApi.apply({ targetUnitId: i.unitId, inwards: i.inwards, autoCreateParts: i.autoCreateParts })
    await hydrateViaModules()
    useStore.setState({ _undo: [], _redo: [] })
  },
}

function skip(_what: string): Promise<unknown> {
  toast.warning('Saved locally — sign in as admin to persist this change to the server.')
  return Promise.resolve()
}

async function sync(name: CommandName, input: unknown, result: unknown, module: Module): Promise<void> {
  const isAdmin = currentUser(useStore.getState())?.role === 'admin'

  // undo/redo can't be mapped to a single endpoint; the admin snapshot reconciles
  // the reverted full state (non-admins keep undo local-only).
  if (name === 'undo' || name === 'redo') {
    if (isAdmin) await pushFullState()
    return
  }

  // Prefer the command's own module endpoint — for EVERY role, admin included.
  const handler = MODULE_SYNC[name]
  if (handler) {
    try {
      await handler(input, result, module)
      if (isCreateCommand(name, input)) await refreshAllData()
    } catch {
      toast.warning('Backend sync failed — changes saved locally.')
    }
    return
  }

  // Unmapped (e.g. importMioWorkbook): only an admin can snapshot the whole book.
  if (isAdmin) {
    await pushFullState()
    return
  }
  toast.warning('Saved locally — sign in as admin to persist this change to the server.')
}

function storedInvoice(id: string): any { // eslint-disable-line @typescript-eslint/no-explicit-any
  return useStore.getState().billing.invoices.byId[id]
}

/** Commands that add records and therefore need an immediate server-authoritative reload. */
function isCreateCommand(name: CommandName, input: unknown): boolean {
  const value = input as { id?: string; existingId?: string | null } | null
  if (name === 'saveInward' || name === 'saveScrapBill' || name === 'saveExpense' || name === 'saveRejectionAdvice') {
    return !value?.id
  }
  if (name === 'saveMaster') return !value?.existingId && !value?.id
  return [
    'saveOutwardDispatch',
    'finalizeInvoice',
    'recordPayment',
    'recordExpensePayment',
    'saveProductionAttendance',
    'saveShiftAttendance',
    'createUser',
    'createRole',
  ].includes(name)
}
/* eslint-enable @typescript-eslint/no-explicit-any */
