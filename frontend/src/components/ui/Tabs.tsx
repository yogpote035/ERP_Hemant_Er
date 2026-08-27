import { cn } from '@/lib/cn'

export interface TabItem<T extends string> {
  value: T
  label: string
}

export interface TabsProps<T extends string> {
  items: ReadonlyArray<TabItem<T>>
  value: T
  onChange: (value: T) => void
  /** Accessible label for the tablist. */
  ariaLabel?: string
  className?: string
}

/**
 * Segmented control — the mock's `.tabs` pill group. The active segment fills
 * blue. These FILTER the view (they don't reveal/hide panels), so the correct
 * semantics are a button group with `aria-pressed`, NOT ARIA tabs (which would
 * promise tabpanels that don't exist).
 */
export function Tabs<T extends string>({ items, value, onChange, ariaLabel, className }: TabsProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('inline-flex gap-0.5 rounded-lg border border-border bg-card p-0.5', className)}
    >
      {items.map((it) => {
        const active = it.value === value
        return (
          <button
            key={it.value}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(it.value)}
            className={cn(
              'rounded-md px-3 py-1.5 text-xs font-medium transition-colors focus-visible:ring-2 focus-visible:ring-ring',
              active ? 'bg-primary text-primary-fg shadow-sm' : 'text-muted-fg hover:text-fg'
            )}
          >
            {it.label}
          </button>
        )
      })}
    </div>
  )
}
