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

const customerSpec = MASTER_SPECS.find((s) => s.key === 'customer') as MasterView

/** Customer Management (client review §8) — a dedicated module for the customer
 *  master, mirroring Vendor Management. Reuses the registered customer spec, so
 *  the form, validation and command bus are shared with the Masters workspace. */
export default function Customers() {
  const customersColl = useStore(useShallow((s) => values(s.masters.customers)))

  const stats = useMemo(() => {
    const active = customersColl.filter((c) => c.active !== false)
    const onHold = customersColl.filter((c) => c.active === false)
    const gstVerified = active.filter((c) => !!c.gstin)
    const interState = active.filter((c) => c.stateCode && c.stateCode !== '27')
    return { active: active.length, onHold: onHold.length, gstVerified: gstVerified.length, interState: interState.length }
  }, [customersColl])

  async function onExport() {
    const rows = customersColl.map((c) => ({
      name: c.name,
      gstin: c.gstin ?? '',
      state: c.stateCode ?? '',
      terms: c.paymentTermsDays != null ? `Net ${c.paymentTermsDays}` : '',
      status: c.active === false ? 'Hold' : 'Active',
    }))
    if (rows.length === 0) {
      toast.error('No customers to export')
      return
    }
    await exportRowsToXlsx('customers.xlsx', 'Customers', [
      { key: 'name', label: 'Customer' },
      { key: 'gstin', label: 'GSTIN' },
      { key: 'state', label: 'State' },
      { key: 'terms', label: 'Payment Terms' },
      { key: 'status', label: 'Status' },
    ], rows)
    toast.success(`Exported ${rows.length} customers`)
  }

  return (
    <div className="space-y-4">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold tracking-tight">Customer Management</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">
          Customers, GSTINs, billing states and payment terms.
        </p>
      </div>

      <KpiGrid>
        <Kpi tone="green" label="Active Customers" value={stats.active} sub="in catalogue" />
        <Kpi tone="amber" label="On Hold" value={stats.onHold} sub="deactivated" />
        <Kpi tone="blue" label="GST Verified" value={stats.gstVerified} sub="have a GSTIN" />
        <Kpi tone="purple" label="Inter-state" value={stats.interState} sub="IGST billing" />
      </KpiGrid>

      <EntityManager
        spec={customerSpec}
        actions={
          <Button variant="secondary" size="sm" leftIcon={<Download size={15} />} onClick={onExport}>
            Export
          </Button>
        }
      />
    </div>
  )
}
