import { useState } from 'react'
import { cn } from '@/lib/cn'
import { EntityManager } from './EntityManager'
import type { MasterView } from './types'

/** Tabbed container over a set of master specs (all sharing one module/route). */
export function MasterTabs({ specs }: { specs: MasterView[] }) {
  const [activeKey, setActiveKey] = useState(specs[0]?.key)
  const spec = specs.find((s) => s.key === activeKey) ?? specs[0]
  if (!spec) return null

  return (
    <div className="space-y-4">
      <div role="tablist" className="flex flex-wrap gap-1 overflow-x-auto border-b border-border">
        {specs.map((s) => (
          <button
            key={s.key}
            type="button"
            role="tab"
            aria-selected={s.key === spec.key}
            onClick={() => setActiveKey(s.key)}
            className={cn(
              '-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              s.key === spec.key
                ? 'border-primary text-primary'
                : 'border-transparent text-muted-fg hover:text-fg'
            )}
          >
            <s.icon size={15} />
            {s.labelPlural}
          </button>
        ))}
      </div>
      {/* keyed so per-master modal/confirm state resets when switching tabs */}
      <EntityManager key={spec.key} spec={spec} />
    </div>
  )
}
