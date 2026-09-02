import { Link } from 'react-router-dom'
import { MASTER_SPECS } from '@/masters/registry'
import { EntityManager } from '@/masters/EntityManager'
import type { MasterView } from '@/masters/types'

// Reuse the registered Part master spec — same validation, form and command bus
// the v1 Masters page used, surfaced as a dedicated "Raw Material Master" screen.
const partSpec = MASTER_SPECS.find((s) => s.key === 'part') as MasterView

/** Raw Material Master (mock §2) — part numbers, HSN codes and GST rates. */
export default function Materials({ embedded = false }: { embedded?: boolean }) {
  return (
    <div className="space-y-4">
      {!embedded ? (
        <div className="min-w-0">
          <h1 className="text-[22px] font-bold tracking-tight">Raw Material Master</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">
            Manage part numbers, HSN codes and GST rates across the catalogue.
          </p>
        </div>
      ) : null}

      <EntityManager spec={partSpec} />

      <p className="text-[11px] text-faint">
        Units, customers, machines and opening stock live in the full{' '}
        <Link to="/masters" className="text-primary hover:underline">Masters</Link> workspace.
      </p>
    </div>
  )
}
