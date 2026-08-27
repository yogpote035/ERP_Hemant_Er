import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, Check, Search } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOnClickOutside } from '@/hooks/useOnClickOutside'
import type { DropdownOption } from './SearchableDropdown'

export interface MultiSelectDropdownProps {
  /** Selected option values. */
  values: string[]
  onChange: (values: string[]) => void
  options: DropdownOption[]
  placeholder?: string
  searchPlaceholder?: string
  /** Word used in the "N <unit> selected" trigger label. */
  unitLabel?: string
  disabled?: boolean
  className?: string
  id?: string
  'aria-label'?: string
}

/**
 * Multi-select sibling of `SearchableDropdown`: same look + keyboard model, but
 * clicking an option TOGGLES it (the menu stays open) and the trigger shows how
 * many are picked. Used where one control selects several records (e.g. choosing
 * multiple inward challans for one invoice).
 */
export function MultiSelectDropdown({
  values,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  unitLabel = 'selected',
  disabled,
  className,
  id,
  'aria-label': ariaLabel,
}: MultiSelectDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  const selectedSet = useMemo(() => new Set(values), [values])
  const showSearch = options.length > 7 || options.some((o) => o.subtitle != null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return options
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        (o.subtitle?.toLowerCase().includes(q) ?? false) ||
        (o.hint?.toLowerCase().includes(q) ?? false)
    )
  }, [options, query])

  useOnClickOutside(rootRef, () => setOpen(false), open)

  useEffect(() => {
    if (!open) return
    setQuery('')
    setActive(0)
    const t = setTimeout(() => (showSearch ? searchRef.current?.focus() : listRef.current?.focus()), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // Esc closes only this dropdown (not a parent Modal/Drawer) — capture-phase listener.
  useEffect(() => {
    if (!open) return
    const onDocKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    document.addEventListener('keydown', onDocKey, true)
    return () => document.removeEventListener('keydown', onDocKey, true)
  }, [open])

  function toggle(idx: number) {
    const opt = filtered[idx]
    if (!opt || opt.disabled) return
    if (selectedSet.has(opt.value)) onChange(values.filter((v) => v !== opt.value))
    else onChange([...values, opt.value])
    // stay open for more picks
  }

  function onKeyDown(e: ReactKeyboardEvent) {
    if (!open) {
      if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        setOpen(true)
      }
      return
    }
    switch (e.key) {
      case 'ArrowDown': e.preventDefault(); setActive((a) => Math.min(a + 1, filtered.length - 1)); break
      case 'ArrowUp': e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); break
      case 'Home': e.preventDefault(); setActive(0); break
      case 'End': e.preventDefault(); setActive(filtered.length - 1); break
      case 'Enter': case ' ': e.preventDefault(); toggle(active); break
      case 'Escape': e.preventDefault(); e.stopPropagation(); setOpen(false); buttonRef.current?.focus(); break
      case 'Tab': setOpen(false); break
    }
  }

  const label = values.length === 0 ? placeholder : `${values.length} ${unitLabel}`

  return (
    <div ref={rootRef} className={cn('relative', className)}>
      <button
        ref={buttonRef}
        type="button"
        id={id}
        disabled={disabled}
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-label={ariaLabel}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn('input flex items-center gap-2 pr-9 text-left', values.length === 0 && 'text-muted-fg')}
      >
        <span className="min-w-0 flex-1 truncate">{label}</span>
      </button>
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg" aria-hidden />

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          {showSearch ? (
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <Search size={14} className="shrink-0 text-muted-fg" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => { setQuery(e.target.value); setActive(0) }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted-fg"
                aria-label={searchPlaceholder}
              />
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            aria-multiselectable
            tabIndex={-1}
            onKeyDown={onKeyDown}
            className="scrollbar-thin max-h-60 overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-faint">No matches</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = selectedSet.has(o.value)
                return (
                  <li
                    key={o.value}
                    data-idx={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => toggle(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                      o.disabled && 'cursor-not-allowed opacity-50',
                      i === active ? 'bg-primary/10' : ''
                    )}
                  >
                    <span className={cn('grid h-4 w-4 shrink-0 place-items-center rounded border', isSelected ? 'border-primary bg-primary text-white' : 'border-border')}>
                      {isSelected ? <Check size={12} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', i === active ? 'text-primary' : 'text-fg')}>{o.label}</span>
                      {o.subtitle ? <span className="block truncate text-[11px] text-faint">{o.subtitle}</span> : null}
                    </span>
                    {o.hint ? <span className="shrink-0 text-[11px] text-faint">{o.hint}</span> : null}
                  </li>
                )
              })
            )}
          </ul>
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-faint">
            <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 font-sans">↵</kbd> Toggle</span>
            <span className="ml-auto tabular-nums">{values.length} selected · {filtered.length} option{filtered.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
