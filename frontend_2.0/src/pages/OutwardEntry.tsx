import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowLeft, ArrowUpFromLine, ReceiptText, X } from 'lucide-react'
import { addP, formatINRSymbol, mulQty, pctOfPaise, toPaise, fromPaise, type Paise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { useStore } from '@/store'
import { latestProductionRatePaise, selectOpenInwardRows } from '@/selectors/register'
import { runSaveDispatchBatch, type DispatchBatchLine } from '@/store/registerCommands'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, EmptyState, MultiSelectDropdown } from '@/components/ui'

interface LineState {
  key: string
  challanId: string // parent inward challan (one line per selected challan)
  bill: string // Our D/C No
  dcDate: string // Our D.C Date
  ok: string
  mc: string
  mf: string
  rate: string
  remark: string
}

let _seq = 0
const intOf = (v: string): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const intFmt = (n: number) => n.toLocaleString('en-IN')
const ZERO = 0 as Paise

export default function OutwardEntry({
  embedded = false,
  initialChallanId,
  onDone,
}: {
  embedded?: boolean
  /** Pre-select this inward challan (the Inward "Create Invoice" action). */
  initialChallanId?: string
  /** Invoked after a successful save or a back action — lets the host close the overlay. */
  onDone?: () => void
}) {
  const can = useCan()
  const canCreate = can('dispatch', 'create')
  const openRows = useStore(useShallow(selectOpenInwardRows))
  const partsById = useStore((s) => s.masters.parts.byId)

  const challanById = useMemo(() => new Map(openRows.map((r) => [r.inward.id, r])), [openRows])
  const gstOf = useCallback(
    (challanId: string): number => {
      const r = challanById.get(challanId)
      const p = r ? partsById[r.inward.partId] : undefined
      return p?.gstPct ?? 18
    },
    [challanById, partsById]
  )

  const [lines, setLines] = useState<LineState[]>([])
  const [submitting, setSubmitting] = useState(false)
  const selectedIds = useMemo(() => lines.map((l) => l.challanId), [lines])

  // First selected challan drives the reference card's auto-fields.
  const primary = selectedIds[0] ? challanById.get(selectedIds[0]) : undefined
  const primaryPart = primary ? partsById[primary.inward.partId] : undefined

  const lineForChallan = useCallback((challanId: string): LineState => {
    const partId = challanById.get(challanId)?.inward.partId ?? ''
    const ratePaise = partId ? latestProductionRatePaise(useStore.getState(), partId) : undefined
    return { key: `ln-${_seq++}`, challanId, bill: '', dcDate: todayISO(), ok: '', mc: '', mf: '', rate: ratePaise != null ? String(fromPaise(ratePaise)) : '', remark: '' }
  }, [challanById])

  // Reconcile the line list to the multi-select: keep existing, add new, drop un-ticked.
  const setSelected = useCallback((ids: string[]) => {
    setLines((prev) => {
      const byId = new Map(prev.map((l) => [l.challanId, l]))
      return ids.map((id) => byId.get(id) ?? lineForChallan(id))
    })
  }, [lineForChallan])

  // Seed selection from the Inward "Create Invoice" deep-link — exactly once per
  // challan (a ref guard, so a re-derived challanById can't re-trigger setState → loop).
  const seededRef = useRef<string | undefined>(undefined)
  useEffect(() => {
    if (!initialChallanId || seededRef.current === initialChallanId) return
    if (challanById.has(initialChallanId)) {
      seededRef.current = initialChallanId
      setSelected([initialChallanId])
    }
  }, [initialChallanId, challanById, setSelected])

  const challanOptions = useMemo(
    () => openRows.map((r) => ({ value: r.inward.id, label: r.inward.challanNo, subtitle: `${r.partNo} · heat ${r.inward.batchHeatNo} · avail ${intFmt(r.available)}` })),
    [openRows]
  )

  const computed = useMemo(() => {
    const rows = lines.map((ln) => {
      const ok = intOf(ln.ok)
      const mc = intOf(ln.mc)
      const mf = intOf(ln.mf)
      const ratePaise = ln.rate ? toPaise(Number(ln.rate)) : ZERO
      const total = ok + mc + mf
      const sub = mulQty(ratePaise, ok)
      const igst = pctOfPaise(sub, gstOf(ln.challanId))
      const grand = addP(sub, igst)
      const avail = challanById.get(ln.challanId)?.available ?? 0
      return { ok, mc, mf, total, sub, igst, grand, avail, over: total > avail }
    })
    const totals = rows.reduce(
      (a, r) => ({
        ok: a.ok + r.ok, mc: a.mc + r.mc, mf: a.mf + r.mf, total: a.total + r.total,
        sub: addP(a.sub, r.sub), igst: addP(a.igst, r.igst), grand: addP(a.grand, r.grand),
      }),
      { ok: 0, mc: 0, mf: 0, total: 0, sub: ZERO, igst: ZERO, grand: ZERO }
    )
    return { rows, totals }
  }, [lines, gstOf, challanById])

  const over = computed.rows.some((r) => r.over)

  function setLine(key: string, patch: Partial<LineState>) {
    setLines((prev) => prev.map((ln) => (ln.key === key ? { ...ln, ...patch } : ln)))
  }
  function removeLine(challanId: string) {
    setLines((prev) => prev.filter((ln) => ln.challanId !== challanId))
  }

  function onSave() {
    const today = todayISO()
    const byChallan = new Map<string, DispatchBatchLine[]>()
    for (const ln of lines) {
      const ok = intOf(ln.ok)
      const mc = intOf(ln.mc)
      const mf = intOf(ln.mf)
      if (ok + mc + mf <= 0) continue
      const rate = ln.rate ? Number(ln.rate) : 0
      const billed = rate > 0 && ok > 0
      const dcDate = ln.dcDate || today
      const line: DispatchBatchLine = {
        kind: billed ? 'billed' : 'rejection',
        okQty: ok, mcRejQty: mc, mfQty: mf,
        billNo: ln.bill.trim() || undefined,
        billDate: billed ? dcDate : undefined,
        dispatchDate: dcDate,
        ratePaise: billed ? toPaise(rate) : undefined,
        remarks: ln.remark.trim() || undefined,
      }
      const arr = byChallan.get(ln.challanId)
      if (arr) arr.push(line)
      else byChallan.set(ln.challanId, [line])
    }

    if (byChallan.size === 0) {
      toastCommandError(new Error('Add a quantity on at least one selected challan'))
      return
    }
    setSubmitting(true)
    try {
      // Saving the invoice creates the outward dispatch(es) in the background and a
      // DRAFT invoice (via relinkInvoice). The user issues it later on Billing & Invoice.
      for (const [inwardId, batchLines] of byChallan) {
        runSaveDispatchBatch({ inwardId, lines: batchLines })
      }
      const challanNote = `${byChallan.size} challan${byChallan.size === 1 ? '' : 's'}`
      toastCommandSuccess('Draft invoice created · outward recorded · stock updated', [
        `across ${challanNote}`,
        'finalise & issue it on Billing & Invoice',
      ])
      setLines([])
      onDone?.()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  if (openRows.length === 0) {
    return (
      <div className="space-y-4">
        <PageHead embedded={embedded} />
        <Card>
          <EmptyState icon={ArrowUpFromLine} title="No open challans" description="Every challan in your scope is fully dispatched. Record an inward challan first." />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {onDone ? (
        <button type="button" onClick={onDone} className="inline-flex items-center gap-1.5 text-[13px] text-muted-fg hover:text-fg">
          <ArrowLeft size={15} /> Back to Inward
        </button>
      ) : null}
      <PageHead embedded={embedded} />

      <div className="rounded-lg border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-[12px] text-primary">
        Pick <b>one or more inward challans</b> — each becomes a dispatch line below. <b>Create draft invoice</b>
        records the outward dispatch(es) in the background, updates stock and creates a <b>draft</b> invoice you then
        issue on Billing &amp; Invoice. Use the same <b>Our D/C No</b> across challans to combine them into one invoice.
      </div>

      {/* Reference card */}
      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Reference — parent inward challan{selectedIds.length > 1 ? 's' : ''}</div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Fld label="REF DC No (inward challans)">
              <MultiSelectDropdown
                aria-label="REF DC No (inward challans)"
                values={selectedIds}
                onChange={setSelected}
                options={challanOptions}
                placeholder="Select one or more challans…"
                unitLabel="challans selected"
              />
            </Fld>
            <Fld label="REF DC Date (auto)">
              <input value={primary?.inward.challanDate ?? ''} disabled className="input h-9" />
            </Fld>
            <Fld label="Part no (auto)">
              <input value={primary?.partNo ?? ''} disabled className="input h-9" />
            </Fld>
            <Fld label="Heat no (auto)">
              <input value={primary?.inward.batchHeatNo ?? ''} disabled className="input h-9" />
            </Fld>
            <Fld label="GST % (auto)">
              <input type="number" value={primaryPart?.gstPct ?? ''} disabled className="input h-9" />
            </Fld>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
            {selectedIds.length > 1 ? (
              <span className="text-faint">Auto-fields show <b className="text-muted-fg">{primary?.inward.challanNo}</b> (first of {selectedIds.length}). Each challan has its own line below.</span>
            ) : (
              <>
                <span className="text-muted-fg">Received: <b className="text-fg">{intFmt(primary?.received ?? 0)}</b></span>
                <span className="text-muted-fg">Already dispatched: <b className="text-fg">{intFmt(primary?.dispatched ?? 0)}</b></span>
                <span className="text-primary">Available stock: <b>{intFmt(primary?.available ?? 0)}</b></span>
              </>
            )}
          </div>
        </div>
      </Card>

      {/* Dispatch lines (one per selected challan) */}
      {lines.length === 0 ? (
        <Card>
          <EmptyState icon={ArrowUpFromLine} title="No challans selected" description="Pick one or more challans above to add dispatch lines." />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Dispatch lines</div>
          <table className="w-full text-[12px]" aria-label="Dispatch lines">
            <thead>
              <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2 font-semibold" style={{ width: 180 }}>Ref D/C No (challan)</th>
                <th scope="col" className="px-3 py-2 font-semibold" style={{ width: 120 }}>Our D/C No</th>
                <th scope="col" className="px-3 py-2 font-semibold" style={{ width: 130 }}>Our D.C Date</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">OK qty</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">M/C rej</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">MF</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Rate ₹</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Sub amt</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">IGST</th>
                <th scope="col" className="px-3 py-2 text-right font-semibold">Grand</th>
                <th scope="col" className="px-3 py-2 font-semibold" style={{ width: 120 }}>Remark</th>
                <th scope="col" className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {lines.map((ln, i) => {
                const c = computed.rows[i]!
                const r = challanById.get(ln.challanId)
                return (
                  <tr key={ln.key} className="border-t border-border/60 align-top">
                    <td className="px-3 py-1.5">
                      <div className="mono font-medium">{r?.inward.challanNo ?? '—'}</div>
                      <div className={`text-[10px] ${c.over ? 'text-danger' : 'text-faint'}`}>{r?.partNo ?? ''} · {intFmt(c.total)}/{intFmt(c.avail)} avail{c.over ? ' ⚠' : ''}</div>
                    </td>
                    <td className="px-2 py-1.5"><input value={ln.bill} onChange={(e) => setLine(ln.key, { bill: e.target.value })} placeholder="Our D/C" aria-label={`Line ${i + 1} our D/C no`} className="cell-input text-left" /></td>
                    <td className="px-2 py-1.5"><input type="date" value={ln.dcDate} onChange={(e) => setLine(ln.key, { dcDate: e.target.value })} aria-label={`Line ${i + 1} our D.C date`} className="cell-input text-left" /></td>
                    <td className="px-2 py-1.5"><CellNum value={ln.ok} onChange={(v) => setLine(ln.key, { ok: v })} label={`Line ${i + 1} OK qty`} /></td>
                    <td className="px-2 py-1.5"><CellNum value={ln.mc} onChange={(v) => setLine(ln.key, { mc: v })} label={`Line ${i + 1} machine reject`} /></td>
                    <td className="px-2 py-1.5"><CellNum value={ln.mf} onChange={(v) => setLine(ln.key, { mf: v })} label={`Line ${i + 1} material fault`} /></td>
                    <td className="px-3 py-1.5 text-right mono font-semibold">{intFmt(c.total)}</td>
                    <td className="px-2 py-1.5"><CellNum value={ln.rate} onChange={(v) => setLine(ln.key, { rate: v })} label={`Line ${i + 1} rate`} step="0.01" /></td>
                    <td className="px-3 py-1.5 text-right mono text-muted-fg">{formatINRSymbol(c.sub)}</td>
                    <td className="px-3 py-1.5 text-right mono text-muted-fg">{formatINRSymbol(c.igst)}</td>
                    <td className="px-3 py-1.5 text-right mono font-semibold">{formatINRSymbol(c.grand)}</td>
                    <td className="px-2 py-1.5"><input value={ln.remark} onChange={(e) => setLine(ln.key, { remark: e.target.value })} placeholder="—" aria-label={`Line ${i + 1} remark`} className="cell-input text-left" /></td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={() => removeLine(ln.challanId)} aria-label={`Remove ${r?.inward.challanNo ?? 'line'}`} className="btn btn-ghost h-7 w-7 p-0 text-faint hover:text-danger">
                        <X size={14} />
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            <tfoot>
              <tr className="border-t border-border bg-muted font-bold">
                <td className="px-3 py-2.5" colSpan={3}>Totals · {lines.length} challan{lines.length === 1 ? '' : 's'}</td>
                <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.ok)}</td>
                <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.mc)}</td>
                <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.mf)}</td>
                <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.total)}</td>
                <td />
                <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(computed.totals.sub)}</td>
                <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(computed.totals.igst)}</td>
                <td className="px-3 py-2.5 text-right mono text-primary">{formatINRSymbol(computed.totals.grand)}</td>
                <td />
                <td />
              </tr>
            </tfoot>
          </table>
        </Card>
      )}

      {/* Form bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        {canCreate ? (
          <Button leftIcon={<ReceiptText size={15} />} onClick={onSave} loading={submitting} disabled={over || computed.totals.total <= 0}>
            Create draft invoice
          </Button>
        ) : null}
        {over ? (
          <span className="text-[12px] font-semibold text-warning">⚠ A line total exceeds the challan's available stock</span>
        ) : null}
      </div>
    </div>
  )
}

function PageHead({ embedded }: { embedded?: boolean }) {
  if (embedded) return null
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Create Invoice</h1>
      <p className="mt-0.5 text-[13px] text-muted-fg">Select one or more inward challans, fill the lines, and create a draft invoice (the outward is recorded automatically).</p>
    </div>
  )
}

function Fld({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-[11.5px] font-medium text-muted-fg">{label}</span>
      {children}
    </label>
  )
}

function CellNum({ value, onChange, label, step }: { value: string; onChange: (v: string) => void; label: string; step?: string }) {
  return (
    <input type="number" min={0} step={step} value={value} onChange={(e) => onChange(e.target.value)} aria-label={label} className="cell-input text-right" />
  )
}
