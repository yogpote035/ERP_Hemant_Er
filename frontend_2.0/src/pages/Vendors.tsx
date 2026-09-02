import { useMemo } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useStore } from '@/store'
import { values } from '@/store/normalized'
import { MASTER_SPECS } from '@/masters/registry'
import { EntityManager } from '@/masters/EntityManager'
import { Kpi, KpiGrid } from '@/components/ui'
import type { MasterView } from '@/masters/types'

const vendorSpec = MASTER_SPECS.find((s) => s.key === 'vendor') as MasterView

/** Vendor Management (mock §3) — suppliers, GST profiles, banking, ledgers. */
export default function Vendors() {
  const vendorsColl = useStore(useShallow((s) => values(s.masters.vendors)))

  const stats = useMemo(() => {
    const active = vendorsColl.filter((v) => v.active !== false)
    const onHold = vendorsColl.filter((v) => v.active === false)
    const gstVerified = active.filter((v) => !!v.gstin)
    const rm = active.filter((v) => v.type === 'rm')
    return { active: active.length, onHold: onHold.length, gstVerified: gstVerified.length, rm: rm.length }
  }, [vendorsColl])

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight">Vendor Management</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">
          Suppliers, GST profiles, banking details and outstanding ledgers.
        </p>
      </div>

      <KpiGrid>
        <Kpi tone="green" label="Active Vendors" value={stats.active} sub="in catalogue" />
        <Kpi tone="amber" label="On Hold" value={stats.onHold} sub="deactivated" />
        <Kpi tone="blue" label="GST Verified" value={stats.gstVerified} sub="have a GSTIN" />
        <Kpi tone="purple" label="RM Suppliers" value={stats.rm} sub="raw-material vendors" />
      </KpiGrid>

      <EntityManager spec={vendorSpec} />
    </div>
  )
}
