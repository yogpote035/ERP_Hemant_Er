import { useMemo } from 'react'
import { Download } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { values } from '@/store/normalized'
import { MASTER_SPECS } from '@/masters/registry'
import { EntityManager } from '@/masters/EntityManager'
import { exportRowsToXlsx } from '@/lib/exportXlsx'
import { Button, Kpi, KpiGrid } from '@/components/ui'
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

  async function onExport() {
    const rows = vendorsColl.map((v) => ({
      code: v.code,
      name: v.name,
      type: v.type === 'rm' ? 'Raw material' : 'Service',
      gstin: v.gstin ?? '',
      city: v.city ?? '',
      contact: v.phone ?? '',
      contactPerson: v.contactPerson ?? '',
      status: v.active === false ? 'Hold' : 'Active',
    }))
    if (rows.length === 0) {
      toast.error('No vendors to export')
      return
    }
    await exportRowsToXlsx('vendors.xlsx', 'Vendors', [
      { key: 'code', label: 'Code' },
      { key: 'name', label: 'Vendor' },
      { key: 'type', label: 'Type' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'city', label: 'Location' },
      { key: 'contactPerson', label: 'Contact Person' },
      { key: 'contact', label: 'Contact' },
      { key: 'status', label: 'Status' },
    ], rows)
    toast.success(`Exported ${rows.length} vendors`)
  }

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

      <EntityManager
        spec={vendorSpec}
        actions={
          <Button variant="secondary" size="sm" leftIcon={<Download size={15} />} onClick={onExport}>
            Export
          </Button>
        }
      />
    </div>
  )
}
