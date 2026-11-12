import { useMemo } from 'react'
import { currentUser, useStore } from '@/store'
import { values } from '@/store/normalized'

/** Resolves the unit that new manual entries and imports should inherit. */
export function useEntryUnitContext() {
  const user = useStore(currentUser)
  const currentUnitId = useStore((s) => s.session.currentUnitId)
  const unitsCollection = useStore((s) => s.masters.units)

  return useMemo(() => {
    const allUnits = values(unitsCollection)
    // Older locally cached users and partially-hydrated API sessions may not
    // have the assignment field yet. Treat that as no assigned units instead
    // of crashing the first entry screen while reading `.length`/`.includes`.
    const assignedUnitIds = user?.assignedUnitIds ?? []
    const assigned = user
      ? (user.role === 'admin' ? allUnits : allUnits.filter((unit) => assignedUnitIds.includes(unit.id)))
      : []
    const selected = currentUnitId && currentUnitId !== 'ALL'
      ? assigned.find((unit) => unit.id === currentUnitId)
      : undefined
    const preferred = selected ?? (assigned.length === 1 ? assigned[0] : undefined)
    const isSingleUnit = assigned.length === 1
    const message = isSingleUnit
      ? ''
      : preferred
        ? `Using ${preferred.code} — ${preferred.name}. Change unit from the navbar.`
        : assigned.length > 1
        ? 'Select a unit from the navbar before entering or importing data.'
        : 'No active unit is assigned to your account. Ask an administrator to assign one.'

    return { preferredUnitId: preferred?.id ?? '', preferredUnitCode: preferred?.code ?? '', assignedUnits: assigned, isSingleUnit, message }
  }, [currentUnitId, unitsCollection, user])
}
