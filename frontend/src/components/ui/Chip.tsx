import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type ChipTone = 'default' | 'warn'

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  tone?: ChipTone
  children: ReactNode
}

/**
 * Filter / status chip — the mock's `.chip`. Default is a neutral outlined pill;
 * `warn` tints it amber (e.g. "3 rejection-only rows"). Renders as a button so
 * it stays keyboard-operable even when used purely as a label.
 */
export function Chip({ tone = 'default', className, children, ...rest }: ChipProps) {
  return (
    <button
      type="button"
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors',
        tone === 'warn'
          ? 'border-warning/40 bg-warning/10 text-warning'
          : 'border-border bg-card text-muted-fg hover:text-fg',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
}
