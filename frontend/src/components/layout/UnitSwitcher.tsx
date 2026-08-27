import { useMemo } from 'react'
import type { Id } from '@/types/domain'
import { useStore, currentUser, setActiveUnit } from '@/store'
import { values } from '@/store/normalized'
import { SearchableDropdown } from '@/components/ui'

/**
 * Active-unit selector. Admins switch across every unit (or 'ALL'); a non-admin
 * is limited to their assigned units — the choke point (`allowedUnitIds`) means
 * this can only ever NARROW what they already may read, never widen it.
 */
export function UnitSwitcher() {
  const user = useStore(currentUser)
  // Select the stable normalized slice; derive the array in a memo so this
  // doesn't re-render on every unrelated store write (e.g. an activity-log push).
  const unitsColl = useStore((s) => s.masters.units)
  const current = useStore((s) => s.session.currentUnitId)
  const units = useMemo(() => values(unitsColl), [unitsColl])
  if (!user) return null

  const isAdmin = user.role === 'admin'
  const visible = (isAdmin ? units : units.filter((u) => user.assignedUnitIds.includes(u.id))).filter(
    (u) => u.active || u.id === current
  )
  // Offer 'All (my) units' to admins and to any multi-unit user — keyed on the
  // count of ASSIGNED units (not the active-filtered list) so a multi-unit
  // operator never loses the aggregate view.
  const allowAll = isAdmin || user.assignedUnitIds.length > 1

  // A single-unit operator has nothing to switch — show the unit as a chip.
  if (!allowAll) {
    const [only] = visible
    if (!only) return null
    return (
      <span className="badge bg-muted text-muted-fg" title={only.name}>
        {only.code}
      </span>
    )
  }

  return (
    <SearchableDropdown
      aria-label="Active unit"
      value={current && current !== 'ALL' ? current : 'ALL'}
      onChange={(v) => setActiveUnit(v as Id | 'ALL')}
      className="w-auto min-w-[10rem] text-sm"
      options={[
        { value: 'ALL', label: isAdmin ? 'All units' : 'All my units' },
        ...visible.map((u) => ({ value: u.id, label: u.code, subtitle: u.name })),
      ]}
    />
  )
}
