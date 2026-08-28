import { useSyncExternalStore } from 'react'
import { hydrateViaModules } from './hydrate'

let activeRefresh: Promise<void> | null = null
let revision = 0
const listeners = new Set<() => void>()

function notifyRefresh(): void {
  revision += 1
  listeners.forEach((listener) => listener())
}

/** Re-fetch all module data and notify server-paginated views to reload their page. */
export function refreshAllData(): Promise<void> {
  if (activeRefresh) return activeRefresh
  activeRefresh = hydrateViaModules()
    .then(() => notifyRefresh())
    .finally(() => { activeRefresh = null })
  return activeRefresh
}

export function useDataRefreshRevision(): number {
  return useSyncExternalStore(
    (listener) => {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    () => revision,
    () => revision,
  )
}
