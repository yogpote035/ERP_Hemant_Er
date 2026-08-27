import { Download } from 'lucide-react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { values } from '@/store/normalized'
import { MASTER_SPECS } from '@/masters/registry'
import { EntityManager } from '@/masters/EntityManager'
import { exportRowsToXlsx } from '@/lib/exportXlsx'
import { Button } from '@/components/ui'
import type { MasterView } from '@/masters/types'

// Reuse the registered Part master spec — same validation, form and command bus
// the v1 Masters page used, surfaced as a dedicated "Raw Material Master" screen.
const partSpec = MASTER_SPECS.find((s) => s.key === 'part') as MasterView

/** Raw Material Master (mock §2) — part numbers, HSN codes and GST rates. */
export default function Materials({ embedded = false }: { embedded?: boolean }) {
  const partsColl = useStore((s) => s.masters.parts)
  const unitsById = useStore((s) => s.masters.units.byId)

  async function onExport() {
    const rows = values(partsColl).map((p) => ({
      partNo: p.partNo,
      materialCode: p.materialCode,
      description: p.description ?? '',
      uom: p.uom,
      hsnSac: p.hsnSac,
      gstPct: `${p.gstPct}%`,
      unit: unitsById[p.unitId]?.code ?? '',
      category: p.category ?? '',
      editionNo: p.editionNo ?? '',
      avgQtyPerBox: p.avgQtyPerBox,
      status: p.active === false ? 'Inactive' : 'Active',
    }))
    if (rows.length === 0) {
      toast.error('No materials to export')
      return
    }
    await exportRowsToXlsx('raw-materials.xlsx', 'Raw Materials', [
      { key: 'partNo', label: 'Part Number' },
      { key: 'materialCode', label: 'Material Code' },
      { key: 'description', label: 'Description' },
      { key: 'uom', label: 'UOM' },
      { key: 'hsnSac', label: 'HSN Code' },
      { key: 'gstPct', label: 'GST %' },
      { key: 'unit', label: 'Unit' },
      { key: 'category', label: 'Category' },
      { key: 'editionNo', label: 'Edition' },
      { key: 'avgQtyPerBox', label: 'Avg Qty / Box' },
      { key: 'status', label: 'Status' },
    ], rows)
    toast.success(`Exported ${rows.length} materials`)
  }

  const exportBtn = (
    <Button variant="secondary" size="sm" leftIcon={<Download size={15} />} onClick={onExport}>
      Export
    </Button>
  )

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

      <EntityManager spec={partSpec} actions={exportBtn} />

      <p className="text-[11px] text-faint">
        Units, customers, machines and opening stock live in the full{' '}
        <Link to="/masters" className="text-primary hover:underline">Masters</Link> workspace.
      </p>
    </div>
  )
}
