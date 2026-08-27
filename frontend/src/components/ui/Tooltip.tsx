import type { ReactNode } from 'react'
import { cn } from '@/lib/cn'

export type TooltipSide = 'top' | 'bottom' | 'left' | 'right'

const SIDE: Record<TooltipSide, string> = {
  top: 'bottom-full left-1/2 -translate-x-1/2 mb-2',
  bottom: 'top-full left-1/2 -translate-x-1/2 mt-2',
  left: 'right-full top-1/2 -translate-y-1/2 mr-2',
  right: 'left-full top-1/2 -translate-y-1/2 ml-2',
}

/**
 * Lightweight hover/focus tooltip (CSS only, no portal). Good for icon buttons.
 * The visible bubble is decorative (`aria-hidden`) — the trigger MUST carry its
 * own accessible name (e.g. `aria-label`), which is what AT announces; this
 * avoids the always-in-the-a11y-tree problem of an opacity-hidden tooltip.
 */
export function Tooltip({
  content,
  side = 'top',
  children,
  className,
}: {
  content: ReactNode
  side?: TooltipSide
  children: ReactNode
  className?: string
}) {
  return (
    <span className={cn('group/tt relative inline-flex', className)}>
      {children}
      <span
        aria-hidden
        className={cn(
          'pointer-events-none absolute z-50 whitespace-nowrap rounded-md bg-fg px-2 py-1 text-xs font-medium text-bg opacity-0 shadow-md transition-opacity duration-150',
          'group-hover/tt:opacity-100 group-focus-within/tt:opacity-100',
          SIDE[side]
        )}
      >
        {content}
      </span>
    </span>
  )
}
