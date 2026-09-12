import type { RootState } from './state.js'
import { getById, putEntity, values } from './normalized.js'

type UnitRef = { unitId: string; setId: (id: string) => void }
type Owned = { id: string; unitId?: string }
type Collection<T> = { byId: Record<string, T>; allIds: string[] }

/** Converts pre-unit-scoping master data without losing cross-unit usage. A
 * legacy row used by several units is cloned and each transaction is repointed
 * to its own unit's copy. Orphan rows are assigned to the first configured unit
 * so no globally-readable business record remains. */
export function migrateLegacyUnitOwnership(state: RootState): boolean {
  const fallbackUnitId = state.masters.units.allIds[0]
  if (!fallbackUnitId) return false
  let changed = false

  const migrate = <T extends Owned>(collection: Collection<T>, refsFor: (id: string) => UnitRef[], onClone?: (sourceId: string, cloneId: string) => void) => {
    for (const row of values(collection)) {
      if (row.unitId && row.unitId !== 'GLOBAL') continue
      const refs = refsFor(row.id)
      const unitIds = [...new Set(refs.map((ref) => ref.unitId).filter((id) => !!getById(state.masters.units, id)))].sort()
      if (unitIds.length === 0) unitIds.push(fallbackUnitId)
      row.unitId = unitIds[0]
      putEntity(collection, row)
      for (const unitId of unitIds.slice(1)) {
        let cloneId = `${row.id}--${unitId}`
        let suffix = 2
        while (collection.byId[cloneId]) cloneId = `${row.id}--${unitId}-${suffix++}`
        putEntity(collection, { ...row, id: cloneId, unitId } as T)
        onClone?.(row.id, cloneId)
        for (const ref of refs.filter((candidate) => candidate.unitId === unitId)) ref.setId(cloneId)
      }
      changed = true
    }
  }

  migrate(state.masters.customers, (id) => [
    ...values(state.inventory.inwards).filter((r) => r.customerId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.customerId = next } })),
    ...values(state.billing.invoices).filter((r) => r.customerId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.customerId = next } })),
    ...values(state.scrap.scrapBills).filter((r) => r.customerId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.customerId = next } })),
    ...values(state.rejection.rejectionAdvices).filter((r) => r.customerId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.customerId = next } })),
  ])
  migrate(state.masters.vendors, (id) => [
    ...values(state.inventory.inwards).filter((r) => r.vendorId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.vendorId = next } })),
    ...values(state.expenses.expenses).filter((r) => r.vendorId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.vendorId = next } })),
    ...values(state.billing.invoices).filter((r) => r.issuerKind === 'supplier' && r.issuerId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.issuerId = next } })),
  ])
  migrate(state.masters.employees, (id) => [
    ...values(state.hr.production).filter((r) => r.employeeId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.employeeId = next } })),
    ...values(state.hr.shifts).filter((r) => r.employeeId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.employeeId = next } })),
  ])
  migrate(state.masters.operations, (id) =>
    values(state.hr.production).filter((r) => r.operationId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.operationId = next } })),
  )
  migrate(state.masters.parts, (id) => [
    ...values(state.inventory.inwards).filter((r) => r.partId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.partId = next } })),
    ...values(state.masters.stockOpenings).filter((r) => r.partId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.partId = next } })),
    ...values(state.rejection.rejectionAdvices).filter((r) => r.partId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.partId = next } })),
    ...values(state.hr.production).filter((r) => r.partId === id).map((r) => ({ unitId: r.unitId, setId: (next: string) => { r.partId = next } })),
  ], (sourceId, cloneId) => {
    for (const rate of values(state.masters.rmRates).filter((r) => r.partId === sourceId)) {
      putEntity(state.masters.rmRates, { ...rate, id: `${rate.id}--${cloneId}`, partId: cloneId })
    }
    for (const rate of values(state.masters.productionRates).filter((r) => r.partId === sourceId)) {
      putEntity(state.masters.productionRates, { ...rate, id: `${rate.id}--${cloneId}`, partId: cloneId })
    }
  })
  return changed
}
