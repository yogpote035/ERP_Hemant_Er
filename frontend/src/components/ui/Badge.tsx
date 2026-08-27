import type { HTMLAttributes } from 'react'
import { cn } from '@/lib/cn'

export type BadgeTone = 'default' | 'primary' | 'success' | 'warning' | 'danger' | 'muted' | 'accent'

const TONES: Record<BadgeTone, string> = {
  // default/muted carry a border because bg-muted === bg-card in dark mode — the
  // border keeps the pill shape visible on same-coloured surfaces.
  default: 'bg-muted text-fg border border-border',
  primary: 'bg-primary/15 text-primary',
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  muted: 'bg-muted text-muted-fg border border-border',
  accent: 'bg-accent/15 text-accent',
}

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  tone?: BadgeTone
}

/** Small status pill — built on the shared `.badge` base. */
export function Badge({ tone = 'default', className, ...rest }: BadgeProps) {
  return <span className={cn('badge', TONES[tone], className)} {...rest} />
}
