import { useState } from 'react'
import type { Id } from '@/types/domain'
import type { Module } from '@/types/rbac'
import { useCan } from '@/hooks/useCan'
import { Tabs } from '@/components/ui'
import InwardRegister from './InwardRegister'
import OutwardEntry from './OutwardEntry'
import Stock from './Stock'

type TabKey = 'inward' | 'stock'

/** The Inventory sections, in the client's order, each gated by its module. The
 *  manual Outward Entry tab was removed — billing is now invoice-primary: a dispatch
 *  is created in the background when an invoice is created from an inward challan. */
const SECTIONS: { value: TabKey; label: string; module: Module }[] = [
  { value: 'inward', label: 'Inward Entry', module: 'inward' },
  { value: 'stock', label: 'Stock View', module: 'stock' },
]

/**
 * Inventory module — a single workspace that consolidates Raw Material Master,
 * Inward Entry and Stock View as tabs. Creating an invoice from an inward row opens
 * the Create-Invoice form as an overlay; saving it records the outward dispatch in
 * the background and a draft invoice (invoice-primary flow, client review §5).
 */
export default function Inventory() {
  const can = useCan()
  const tabs = SECTIONS.filter((t) => can(t.module, 'view'))
  const [tab, setTab] = useState<TabKey>(tabs[0]?.value ?? 'stock')
  const active = tabs.some((t) => t.value === tab) ? tab : tabs[0]?.value ?? 'stock'

  // Invoice-primary flow: an inward row's "Create Invoice" action opens the form
  // pre-scoped to that challan. Gated by dispatch:create.
  const canInvoice = can('dispatch', 'create')
  const [invoiceInwardId, setInvoiceInwardId] = useState<Id | undefined>(undefined)

  if (invoiceInwardId) {
    return (
      <div className="space-y-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight">Create Invoice</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">From an inward challan — fill the lines and create a draft invoice; the outward is recorded automatically.</p>
        </div>
        <OutwardEntry embedded initialChallanId={invoiceInwardId} onDone={() => setInvoiceInwardId(undefined)} />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-[22px] font-bold tracking-tight">Inventory</h1>
        <p className="mt-0.5 text-[13px] text-muted-fg">Raw material, inward and live stock — one workspace.</p>
      </div>

      {tabs.length > 1 ? (
        <Tabs items={tabs.map(({ value, label }) => ({ value, label }))} value={active} onChange={setTab} ariaLabel="Inventory section" />
      ) : null}

      {active === 'inward' ? (
        <InwardRegister embedded onOpenOutward={canInvoice ? setInvoiceInwardId : undefined} />
      ) : (
        <Stock embedded />
      )}
    </div>
  )
}
