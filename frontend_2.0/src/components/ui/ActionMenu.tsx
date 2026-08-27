import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { MoreVertical } from 'lucide-react'
import { cn } from '@/lib/cn'

export interface ActionMenuItem {
  key: string
  label: string
  icon?: ReactNode
  onClick: () => void
  danger?: boolean
  disabled?: boolean
}

/**
 * Trailing "⋮" row-actions menu. Collapses a row's actions into one kebab button
 * and a dropdown. The menu is PORTALED to <body> with fixed positioning so it is
 * never clipped by a scroll container (e.g. a table's `overflow-x-auto` card).
 * Pass only the items that apply (callers filter by permission/availability).
 */
export function ActionMenu({ items, label = 'Row actions', className }: { items: ActionMenuItem[]; label?: string; className?: string }) {
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const WIDTH = 196

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return
    const r = btnRef.current.getBoundingClientRect()
    setPos({ top: r.bottom + 4, left: Math.max(8, r.right - WIDTH) })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); btnRef.current?.focus() }
    }
    const close = () => setOpen(false)
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
    }
  }, [open])

  if (items.length === 0) return null

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => { e.stopPropagation(); setOpen((o) => !o) }}
        className={cn('btn btn-ghost h-8 w-8 p-0', className)}
      >
        <MoreVertical size={16} />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              style={{ position: 'fixed', top: pos.top, left: pos.left, width: WIDTH }}
              className="z-[100] rounded-xl border border-border bg-card p-1.5 text-card-fg shadow-xl"
            >
              {items.map((it) => (
                <button
                  key={it.key}
                  type="button"
                  role="menuitem"
                  disabled={it.disabled}
                  onClick={(e) => { e.stopPropagation(); setOpen(false); it.onClick() }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] disabled:opacity-40',
                    it.danger ? 'text-danger hover:bg-danger/10' : 'hover:bg-muted'
                  )}
                >
                  {it.icon ? <span className="shrink-0 [&_svg]:size-4">{it.icon}</span> : null}
                  {it.label}
                </button>
              ))}
            </div>,
            document.body
          )
        : null}
    </>
  )
}
