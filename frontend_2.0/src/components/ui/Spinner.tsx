import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/cn'

/** Inline loading spinner; announces itself as a status to assistive tech. */
export function Spinner({ size = 18, className }: { size?: number; className?: string }) {
  return (
    <span role="status" aria-label="Loading">
      <Loader2 size={size} className={cn('animate-spin text-muted-fg', className)} aria-hidden />
    </span>
  )
}
