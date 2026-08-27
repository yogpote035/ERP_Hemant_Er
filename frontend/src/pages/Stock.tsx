import { useShallow } from 'zustand/react/shallow'
import { Boxes } from 'lucide-react'
import { useStore } from '@/store'
import { selectStockRows } from '@/selectors/register'
import { Badge, Card, EmptyState } from '@/components/ui'

/** Live derived stock per (unit, part) — opening + received − consumed. */
export default function Stock() {
  const rows = useStore(useShallow(selectStockRows))
  const unitsById = useStore((s) => s.masters.units.byId)

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold tracking-tight">Stock</h1>
        <p className="mt-0.5 text-[13px] text-muted">Derived from openings, inwards and dispatches — never stored.</p>
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState icon={Boxes} title="No stock to show" description="Add parts, opening stock or inward challans first." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">Unit</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Opening</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Received</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Consumed</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Available</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Reconcile</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={`${r.unitId}:${r.partId}`} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5">{unitsById[r.unitId]?.code ?? r.unitId}</td>
                  <td className="px-3 py-2.5 font-medium">{r.partNo}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.opening.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.received.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.consumed.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{r.available.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5">
                    {r.balanced ? <Badge tone="success">OK</Badge> : <Badge tone="danger">Imbalanced</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}
