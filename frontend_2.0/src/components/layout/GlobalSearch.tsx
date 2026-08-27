import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Search,
  Package,
  Truck,
  Users2,
  ArrowDownToLine,
  ReceiptText,
  CornerDownLeft,
  type LucideIcon,
} from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { cn } from '@/lib/cn'
import { useStore } from '@/store'
import { values } from '@/store/normalized'

interface Hit {
  key: string
  group: string
  label: string
  sub?: string
  to: string
  icon: LucideIcon
}

const includes = (hay: string | undefined, q: string) => !!hay && hay.toLowerCase().includes(q)
const PER_GROUP = 5
const MAX = 12

/**
 * Global search — a live dropdown across parts, vendors, customers, inward
 * challans / heat numbers and invoices. Selecting a result navigates to the
 * relevant screen (challans/heat → the Inward register filtered by ?q). Replaces
 * the old form that only ever routed to /inward and showed nothing for anything
 * else. Keyboard: ↑/↓ move, Enter opens, Esc closes; ARIA combobox + listbox.
 */
export function GlobalSearch() {
  const navigate = useNavigate()
  const [raw, setRaw] = useState('')
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const boxRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listId = useId()

  // Pull the searchable collections (shallow so we don't re-render on unrelated writes).
  const parts = useStore(useShallow((s) => values(s.masters.parts)))
  const vendors = useStore(useShallow((s) => values(s.masters.vendors)))
  const customers = useStore(useShallow((s) => values(s.masters.customers)))
  const inwards = useStore(useShallow((s) => values(s.inventory.inwards)))
  const invoices = useStore(useShallow((s) => values(s.billing.invoices)))
  const vendorsById = useStore((s) => s.masters.vendors.byId)
  const partsById = useStore((s) => s.masters.parts.byId)
  const customersById = useStore((s) => s.masters.customers.byId)

  const q = raw.trim().toLowerCase()

  const hits = useMemo<Hit[]>(() => {
    if (!q) return []
    const out: Hit[] = []

    const partHits = parts
      .filter((p) => includes(p.partNo, q) || includes(p.materialCode, q) || includes(p.description, q) || includes(p.hsnSac, q))
      .slice(0, PER_GROUP)
      .map<Hit>((p) => ({ key: `part:${p.id}`, group: 'Materials', label: p.partNo, sub: `${p.materialCode} · HSN ${p.hsnSac}`, to: '/materials', icon: Package }))

    const vendorHits = vendors
      .filter((v) => includes(v.name, q) || includes(v.code, q) || includes(v.gstin, q))
      .slice(0, PER_GROUP)
      .map<Hit>((v) => ({ key: `vendor:${v.id}`, group: 'Vendors', label: v.name, sub: v.code, to: '/vendors', icon: Truck }))

    const custHits = customers
      .filter((c) => includes(c.name, q) || includes(c.gstin, q))
      .slice(0, PER_GROUP)
      .map<Hit>((c) => ({ key: `cust:${c.id}`, group: 'Customers', label: c.name, sub: c.gstin, to: '/billing', icon: Users2 }))

    const inwardHits = inwards
      .filter((i) => includes(i.challanNo, q) || includes(i.batchHeatNo, q) || includes(i.poNo, q))
      .slice(0, PER_GROUP)
      .map<Hit>((i) => {
        const heatMatch = !includes(i.challanNo, q) && includes(i.batchHeatNo, q)
        const term = heatMatch ? i.batchHeatNo : i.challanNo
        return {
          key: `inward:${i.id}`,
          group: 'Inward',
          label: term,
          sub: `${heatMatch ? 'Heat' : 'Challan'} · ${vendorsById[i.vendorId ?? '']?.name ?? partsById[i.partId]?.partNo ?? ''}`.trim().replace(/·\s*$/, '').trim(),
          to: `/inward?q=${encodeURIComponent(term)}`,
          icon: ArrowDownToLine,
        }
      })

    const invoiceHits = invoices
      .filter((inv) => includes(inv.billNo, q) || includes(customersById[inv.customerId ?? '']?.name, q))
      .slice(0, PER_GROUP)
      .map<Hit>((inv) => ({ key: `inv:${inv.id}`, group: 'Invoices', label: inv.billNo, sub: customersById[inv.customerId ?? '']?.name ?? '—', to: '/billing', icon: ReceiptText }))

    out.push(...partHits, ...vendorHits, ...custHits, ...inwardHits, ...invoiceHits)
    return out.slice(0, MAX)
  }, [q, parts, vendors, customers, inwards, invoices, vendorsById, partsById, customersById])

  // Reset the highlighted row whenever the result set changes.
  useEffect(() => setActive(0), [q])

  useOutside(boxRef, () => setOpen(false))

  function select(hit: Hit) {
    navigate(hit.to)
    setOpen(false)
    setRaw('')
    inputRef.current?.blur()
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Escape') {
      setOpen(false)
      return
    }
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
      setOpen(true)
      return
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, hits.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const hit = hits[active]
      if (hit) select(hit)
      else if (q) {
        // Fallback: take whatever was typed to the register's text filter.
        navigate(`/inward?q=${encodeURIComponent(raw.trim())}`)
        setOpen(false)
      }
    }
  }

  const showPanel = open && q.length > 0

  return (
    <div ref={boxRef} className="relative ml-auto hidden md:block">
      <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" />
      <input
        ref={inputRef}
        type="text"
        role="combobox"
        aria-expanded={showPanel}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showPanel && hits[active] ? `${listId}-${active}` : undefined}
        value={raw}
        onChange={(e) => {
          setRaw(e.target.value)
          setOpen(true)
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
        aria-label="Search invoices, materials, vendors, heat no"
        placeholder="Search invoices, materials, vendors…"
        className="w-56 rounded-lg border border-border bg-bg py-1.5 pl-8 pr-3 text-xs text-fg placeholder:text-faint focus-visible:ring-2 focus-visible:ring-ring lg:w-72"
      />

      {showPanel ? (
        <div
          id={listId}
          role="listbox"
          className="absolute right-0 z-50 mt-1.5 max-h-[60vh] w-80 overflow-y-auto rounded-xl border border-border bg-card p-1.5 shadow-lg lg:w-96"
        >
          {hits.length === 0 ? (
            <div className="px-3 py-6 text-center text-[12.5px] text-muted-fg">
              No matches for <span className="font-medium text-fg">“{raw.trim()}”</span>
            </div>
          ) : (
            hits.map((hit, i) => {
              const firstOfGroup = i === 0 || hits[i - 1]!.group !== hit.group
              return (
                <div key={hit.key}>
                  {firstOfGroup ? (
                    <div className="px-2.5 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wide text-faint">{hit.group}</div>
                  ) : null}
                  <button
                    type="button"
                    role="option"
                    id={`${listId}-${i}`}
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => select(hit)}
                    className={cn(
                      'flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors',
                      i === active ? 'bg-primary/10 text-primary' : 'text-fg hover:bg-muted'
                    )}
                  >
                    <hit.icon size={15} className="shrink-0 opacity-80" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium">{hit.label}</span>
                      {hit.sub ? <span className="block truncate text-[11px] text-muted-fg">{hit.sub}</span> : null}
                    </span>
                    {i === active ? <CornerDownLeft size={13} className="shrink-0 text-faint" /> : null}
                  </button>
                </div>
              )
            })
          )}
        </div>
      ) : null}
    </div>
  )
}

// Local click-outside (the shared hook lives in @/hooks but we keep this leaf
// component self-contained to avoid a circular import via the layout barrel).
function useOutside(ref: React.RefObject<HTMLElement>, handler: () => void) {
  const cb = useRef(handler)
  cb.current = handler
  useEffect(() => {
    const onDown = (e: MouseEvent | TouchEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) cb.current()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('touchstart', onDown)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('touchstart', onDown)
    }
  }, [ref])
}
