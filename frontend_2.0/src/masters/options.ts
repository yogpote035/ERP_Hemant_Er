/**
 * Shared option-list builders for `select`/`ref` form fields. Unit/part lists use
 * `writableUnitIds` so a form only ever offers units the user may write to.
 */
import { values } from '@/store/normalized'
import { writableUnitIds } from '@/store/scope'
import type { RootState } from '@/store/state'
import type { SelectOption } from './types'

export const unitOptions = (s: RootState): SelectOption[] => {
  const writable = writableUnitIds(s)
  return values(s.masters.units)
    // Assigned units remain selectable even when older API rows omit `active`.
    // An explicit assignment is the write-scope authority for operational forms.
    .filter((u) => writable.has(u.id))
    .map((u) => ({ value: u.id, label: u.code, subtitle: u.name }))
}

export const partOptions = (s: RootState): SelectOption[] => {
  return values(s.masters.parts)
    .filter((p) => p.active)
    .map((p) => ({
      value: p.id,
      label: p.partNo,
      subtitle: `${p.description ?? p.editionNo ?? p.materialCode} · ${p.rmRatePaise != null ? `₹${(p.rmRatePaise / 100).toFixed(2)}/pc` : 'rate not set'}`,
    }))
}

const vendorOpt = (v: { id: string; name: string; gstin?: string }): SelectOption => ({
  value: v.id,
  label: v.name,
  subtitle: v.gstin ? `GSTIN ${v.gstin}` : undefined,
})
export const vendorOptions = (s: RootState): SelectOption[] =>
  values(s.masters.vendors).filter((v) => v.active).map(vendorOpt)
/** RM suppliers only — for the Inward "RM Supplier" picker. */
export const rmVendorOptions = (s: RootState): SelectOption[] =>
  values(s.masters.vendors).filter((v) => v.active).map(vendorOpt)
/** Service vendors only — for the Expense vendor picker. */
export const serviceVendorOptions = (s: RootState): SelectOption[] =>
  values(s.masters.vendors).filter((v) => v.active).map(vendorOpt)

/** Vendors usable for an expense in one selected unit. Explicit unit assignment
 * is preferred; older vendors are inferred only from transactions in that unit. */
export const vendorOptionsForUnit = (unitId: string) => (s: RootState): SelectOption[] => {
  if (!unitId || !writableUnitIds(s).has(unitId)) return []
  return values(s.masters.vendors)
    .filter((v) => v.active)
    .map(vendorOpt)
}

export const customerOptions = (s: RootState): SelectOption[] =>
  values(s.masters.customers)
    .filter((c) => c.active)
    .map((c) => ({ value: c.id, label: c.name, subtitle: `GSTIN ${c.gstin} · state ${c.stateCode}` }))

export const employeeOptions = (s: RootState): SelectOption[] =>
  values(s.masters.employees)
    .filter((e) => e.active)
    .map((e) => ({ value: e.id, label: e.name, subtitle: `${e.empCode} · ${e.labourType}` }))

export const machineOptions = (s: RootState): SelectOption[] =>
  values(s.masters.machines)
    .filter((m) => m.active)
    .map((m) => ({ value: m.id, label: m.machineNo, subtitle: m.description }))

export const operationOptions = (s: RootState): SelectOption[] =>
  values(s.masters.operations)
    .filter((o) => o.active)
    .map((o) => ({ value: o.id, label: o.code, subtitle: o.description }))

// ── Unit-scoped pickers (attendance) ─────────────────────────────────────────
// Parts, machines and employees each belong to exactly one unit. Attendance must
// only offer the records of the unit the operator picked, so a production/shift
// row can never reference a part/machine/employee from another unit. Empty unit ⇒
// empty list (forces the unit to be chosen first).
export const partOptionsForUnit = (unitId: string) => (s: RootState): SelectOption[] =>
  unitId
    ? values(s.masters.parts)
        .filter((p) => p.active)
        .map((p) => ({ value: p.id, label: p.partNo, subtitle: p.materialCode }))
    : []

export const machineOptionsForUnit = (unitId: string) => (s: RootState): SelectOption[] =>
  unitId
    ? values(s.masters.machines)
        .filter((m) => m.active && m.unitId === unitId)
        .map((m) => ({ value: m.id, label: m.machineNo, subtitle: m.description }))
    : []

const supportsAttendanceMethod = (type: string, method?: 'production' | 'shift') =>
  !method || type === method || type === 'both' || !['production', 'shift', 'both'].includes(type)

export const employeeOptionsForUnit =
  (_unitId: string, labourType?: 'production' | 'shift') =>
  (s: RootState): SelectOption[] =>
    values(s.masters.employees)
      .filter((e) => e.active && supportsAttendanceMethod(e.labourType, labourType))
      .map((e) => ({ value: e.id, label: e.name, subtitle: `${e.empCode} · ${e.labourType}` }))

/**
 * Employees across ALL units the user may write to (attendance no longer asks for
 * a unit up front — it derives the unit from the chosen employee). The unit code
 * is shown in the subtitle so a multi-unit operator can tell records apart.
 */
export const employeeOptionsWritable =
  (labourType?: 'production' | 'shift') =>
  (s: RootState): SelectOption[] => {
    return values(s.masters.employees)
      .filter(
        (e) =>
          e.active &&
          supportsAttendanceMethod(e.labourType, labourType)
      )
      .map((e) => ({
        value: e.id,
        label: e.name,
        subtitle: `${e.empCode} · ${e.labourType}`,
      }))
  }

export const GST_OPTIONS: SelectOption[] = [5, 12, 18, 28].map((n) => ({ value: String(n), label: `${n}%` }))
