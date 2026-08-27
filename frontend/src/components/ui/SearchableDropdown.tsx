import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react'
import { ChevronDown, Check, Search, X } from 'lucide-react'
import { cn } from '@/lib/cn'
import { useOnClickOutside } from '@/hooks/useOnClickOutside'

export interface DropdownOption {
  value: string
  label: string
  /** Dimmed SECOND line under the label (e.g. a category, code or unit) — gives
   *  record-backed pickers the two-line look. Its presence also forces the
   *  search box on (these are master/table lists worth filtering). */
  subtitle?: string
  /** Secondary text shown right-aligned / dimmed (e.g. a short code). */
  hint?: string
  disabled?: boolean
}

export interface SearchableDropdownProps {
  value: string
  onChange: (value: string) => void
  options: DropdownOption[]
  placeholder?: string
  searchPlaceholder?: string
  disabled?: boolean
  className?: string
  id?: string
  /** Force the filter input on/off. Default: auto (shown when > 7 options). */
  searchable?: boolean
  /** Show a clear (×) affordance that resets to ''. */
  clearable?: boolean
  'aria-label'?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
  'aria-required'?: boolean
}

/**
 * Accessible combobox used in place of native <select> across the app. Type to
 * filter (auto for long lists), full keyboard nav (↑/↓/Enter/Esc/Home/End), and
 * the `.input` look so it drops into existing forms. Hides UI only — not auth.
 */
export function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder = 'Select…',
  searchPlaceholder = 'Search…',
  disabled,
  className,
  id,
  searchable,
  clearable,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedby,
  'aria-required': ariaRequired,
}: SearchableDropdownProps) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const listId = useId()

  // Record-backed lists (those with subtitles) always get the search box; plain
  // enum lists only when long. `searchable` overrides either way.
  const showSearch = searchable ?? (options.length > 7 || options.some((o) => o.subtitle != null))
  const selected = options.find((o) => o.value === value)

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

  // On open: reset query, focus the search (or the list), and point the active
  // row at the current selection.
  useEffect(() => {
    if (!open) return
    setQuery('')
    const idx = filtered.findIndex((o) => o.value === value)
    setActive(idx >= 0 ? idx : 0)
    const t = setTimeout(() => (showSearch ? searchRef.current?.focus() : listRef.current?.focus()), 0)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  // Keep the active row in view.
  useEffect(() => {
    if (!open) return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-idx="${active}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [active, open])

  // Escape must close ONLY this dropdown — never a parent Modal/Drawer (which would
  // discard the whole form). Those dialogs close on a NATIVE document keydown listener
  // that a React-synthetic stopPropagation can't intercept (they portal as siblings of
  // #root). A capture-phase document listener fires before their bubble-phase listeners,
  // so stopping the event here keeps it from ever reaching them.
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

  function commit(idx: number) {
    const opt = filtered[idx]
    if (!opt || opt.disabled) return
    onChange(opt.value)
    setOpen(false)
    buttonRef.current?.focus()
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
      case 'ArrowDown':
        e.preventDefault()
        setActive((a) => Math.min(a + 1, filtered.length - 1))
        break
      case 'ArrowUp':
        e.preventDefault()
        setActive((a) => Math.max(a - 1, 0))
        break
      case 'Home':
        e.preventDefault()
        setActive(0)
        break
      case 'End':
        e.preventDefault()
        setActive(filtered.length - 1)
        break
      case 'Enter':
        e.preventDefault()
        commit(active)
        break
      case 'Escape':
        e.preventDefault()
        e.stopPropagation() // don't let a parent Drawer/Modal also close on this Esc
        setOpen(false)
        buttonRef.current?.focus()
        break
      case 'Tab':
        setOpen(false)
        break
    }
  }

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
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        aria-required={ariaRequired}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onKeyDown}
        className={cn(
          'input flex items-center gap-2 pr-9 text-left',
          !selected && 'text-muted-fg',
          ariaInvalid && 'border-danger'
        )}
      >
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : placeholder}</span>
        {selected?.hint ? <span className="shrink-0 text-[11px] text-faint">{selected.hint}</span> : null}
      </button>

      {clearable && selected && !disabled ? (
        <button
          type="button"
          aria-label="Clear"
          onClick={() => onChange('')}
          className="absolute right-8 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-fg hover:text-fg"
        >
          <X size={14} />
        </button>
      ) : null}
      <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-muted-fg" aria-hidden />

      {open ? (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-lg border border-border bg-card shadow-xl">
          {showSearch ? (
            <div className="flex items-center gap-2 border-b border-border px-2.5 py-1.5">
              <Search size={14} className="shrink-0 text-muted-fg" aria-hidden />
              <input
                ref={searchRef}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  setActive(0)
                }}
                onKeyDown={onKeyDown}
                placeholder={searchPlaceholder}
                className="w-full bg-transparent text-sm text-fg outline-none placeholder:text-muted-fg"
                role="combobox"
                aria-expanded
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={filtered[active] ? `${listId}-opt-${active}` : undefined}
              />
            </div>
          ) : null}
          <ul
            ref={listRef}
            id={listId}
            role="listbox"
            tabIndex={-1}
            onKeyDown={onKeyDown}
            aria-activedescendant={filtered[active] ? `${listId}-opt-${active}` : undefined}
            className="scrollbar-thin max-h-60 overflow-y-auto py-1 outline-none"
          >
            {filtered.length === 0 ? (
              <li className="px-3 py-2 text-[12px] text-faint">No matches</li>
            ) : (
              filtered.map((o, i) => {
                const isSelected = o.value === value
                return (
                  <li
                    key={o.value}
                    id={`${listId}-opt-${i}`}
                    data-idx={i}
                    role="option"
                    aria-selected={isSelected}
                    aria-disabled={o.disabled}
                    onMouseEnter={() => setActive(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => commit(i)}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 px-3 py-1.5 text-sm',
                      o.disabled && 'cursor-not-allowed opacity-50',
                      i === active ? 'bg-primary/10' : ''
                    )}
                  >
                    <span className="min-w-0 flex-1">
                      <span className={cn('block truncate', i === active ? 'text-primary' : 'text-fg')}>{o.label}</span>
                      {o.subtitle ? <span className="block truncate text-[11px] text-faint">{o.subtitle}</span> : null}
                    </span>
                    {o.hint ? <span className="shrink-0 text-[11px] text-faint">{o.hint}</span> : null}
                    {isSelected ? <Check size={14} className="shrink-0 text-primary" /> : null}
                  </li>
                )
              })
            )}
          </ul>
          {/* Keyboard-hint footer + option count (matches the kit's combobox). */}
          <div className="flex items-center gap-3 border-t border-border px-3 py-1.5 text-[10.5px] text-faint">
            <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 font-sans">↑↓</kbd> Navigate</span>
            <span className="flex items-center gap-1"><kbd className="rounded border border-border px-1 font-sans">↵</kbd> Select</span>
            <span className="ml-auto tabular-nums">{filtered.length} option{filtered.length === 1 ? '' : 's'}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
