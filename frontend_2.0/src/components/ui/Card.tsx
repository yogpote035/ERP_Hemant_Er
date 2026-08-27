import type { HTMLAttributes, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Surface container — the shared `.card` look (bg/border/shadow/rounded/p-4). */
export function Card({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('card', className)} {...rest} />
}

export interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}

/** Title + optional description on the left, an action slot on the right. */
export function CardHeader({ title, description, action, className }: CardHeaderProps) {
  return (
    <div className={cn('flex items-start justify-between gap-3', className)}>
      <div className="min-w-0">
        <h3 className="font-semibold leading-tight truncate">{title}</h3>
        {description ? <p className="text-sm text-muted mt-0.5">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
