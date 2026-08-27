import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X, Maximize2, Minimize2 } from 'lucide-react'
import { cn } from '@/lib/cn'

export type DrawerSize = 'sm' | 'md' | 'lg' | 'xl'

const SIZES: Record<DrawerSize, string> = {
  sm: 'sm:max-w-md',
  md: 'sm:max-w-lg',
  lg: 'sm:max-w-2xl',
  xl: 'sm:max-w-3xl',
}

export interface DrawerProps {
  open: boolean
  onClose: () => void
  title?: React.ReactNode
  description?: React.ReactNode
  children?: React.ReactNode
  footer?: React.ReactNode
  size?: DrawerSize
  /** When false, clicking the backdrop won't close (use for unsaved-changes guards). */
  closeOnBackdrop?: boolean
  /** Show the maximize/restore toggle (full-width). */
  maximizable?: boolean
  defaultMaximized?: boolean
}

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Right slide-in panel — ported from the CRM_Core kit (see its COMPONENT_KIT.md)
 * and adapted to HEW's semantic tokens. Shares the `Modal` prop API
 * (open/onClose/title/description/footer/size/closeOnBackdrop) so it's a drop-in
 * for record/form dialogs, and adds a maximize toggle. Portal + backdrop + Esc +
 * body-scroll lock + full focus management (move-in, Tab trap, restore on close).
 */
export function Drawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = 'md',
  closeOnBackdrop = true,
  maximizable = true,
  defaultMaximized = false,
}: DrawerProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()
  const descId = useId()
  const bodyId = useId()
  const [maximized, setMaximized] = useState(defaultMaximized)

  // Reset to the default size each time it reopens.
  useEffect(() => {
    if (open) setMaximized(defaultMaximized)
  }, [open, defaultMaximized])

  useEffect(() => {
    if (!open) return
    const previouslyFocused = document.activeElement as HTMLElement | null

    const panel = panelRef.current
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE)
    ;(first ?? panel)?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (e.defaultPrevented) return // a child (e.g. an open dropdown) already handled it
        onClose()
        return
      }
      if (e.key !== 'Tab' || !panel) return
      const items = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE))
      if (items.length === 0) {
        e.preventDefault()
        return
      }
      const firstEl = items[0]!
      const lastEl = items[items.length - 1]!
      const active = document.activeElement
      if (e.shiftKey && (active === firstEl || active === panel)) {
        e.preventDefault()
        lastEl.focus()
      } else if (!e.shiftKey && active === lastEl) {
        e.preventDefault()
        firstEl.focus()
      }
    }

    document.addEventListener('keydown', onKey)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      previouslyFocused?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  const widthClass = maximized ? 'sm:max-w-full' : SIZES[size]

  return createPortal(
    <div className="fixed inset-0 z-50">
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm"
        onClick={closeOnBackdrop ? onClose : undefined}
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
        aria-describedby={description ? descId : bodyId}
        tabIndex={-1}
        className={cn(
          'absolute inset-y-0 right-0 flex h-full w-full flex-col border-l border-border bg-card text-card-fg shadow-2xl outline-none transition-all duration-200',
          widthClass
        )}
      >
        {(title || description || maximizable) && (
          <div className="flex items-start justify-between gap-3 border-b border-border bg-muted/40 px-4 py-3">
            <div className="min-w-0">
              {title ? (
                <h2 id={titleId} className="font-semibold leading-tight truncate">
                  {title}
                </h2>
              ) : null}
              {description ? (
                <p id={descId} className="mt-0.5 text-sm text-muted truncate">
                  {description}
                </p>
              ) : null}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {maximizable ? (
                <button
                  type="button"
                  onClick={() => setMaximized((m) => !m)}
                  className="btn btn-ghost hidden h-8 w-8 p-0 sm:inline-flex"
                  aria-label={maximized ? 'Restore size' : 'Maximize'}
                  title={maximized ? 'Restore' : 'Maximize'}
                >
                  {maximized ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                </button>
              ) : null}
              <button
                type="button"
                onClick={onClose}
                className="btn btn-ghost h-8 w-8 p-0"
                aria-label="Close dialog"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        )}
        <div id={bodyId} className="scrollbar-thin flex-1 overflow-y-auto p-4">
          {children}
        </div>
        {footer ? (
          <div className="flex justify-end gap-2 border-t border-border px-4 py-3">{footer}</div>
        ) : null}
      </div>
    </div>,
    document.body
  )
}
