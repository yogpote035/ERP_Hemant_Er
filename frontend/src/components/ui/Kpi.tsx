import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type KpiTone = 'blue' | 'green' | 'amber' | 'purple' | 'red'

/** Corner accent colour per tone — a soft tinted circle bleeding off the card. */
const ACCENT: Record<KpiTone, string> = {
  blue: 'bg-primary',
  green: 'bg-success',
  amber: 'bg-warning',
  purple: 'bg-accent',
  red: 'bg-danger',
}

export interface KpiProps {
  label: string
  value: ReactNode
  sub?: ReactNode
  tone?: KpiTone
  /** Optional icon/element rendered small beside the label. */
  className?: string
}

/**
 * Headline metric card — mirrors the mock's `.kpi`: a value with an uppercase
 * label, a faint sub-line, and a soft accent circle in the top-right corner.
 */
export function Kpi({ label, value, sub, tone = 'blue', className }: KpiProps) {
  return (
    <div className={cn('card relative overflow-hidden p-4', className)}>
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute -right-4 -top-4 h-16 w-16 rounded-full opacity-[0.10]',
          ACCENT[tone]
        )}
      />
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted-fg">{label}</div>
      <div className="mt-1.5 text-2xl font-bold leading-tight tracking-tight">{value}</div>
      {sub ? <div className="mt-0.5 text-[11px] text-faint">{sub}</div> : null}
    </div>
  )
}

/** Responsive grid for a row of KPIs (defaults to 4-up on large screens). */
export function KpiGrid({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cn('grid grid-cols-2 gap-3.5 lg:grid-cols-4', className)}>{children}</div>
  )
}
