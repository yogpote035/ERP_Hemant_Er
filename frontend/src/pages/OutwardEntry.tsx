import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { ArrowUpFromLine, Plus, Save, X } from 'lucide-react'
import { addP, formatINRSymbol, mulQty, pctOfPaise, toPaise, fromPaise, type Paise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { useStore } from '@/store'
import { selectInwardRows, selectOpenInwardRows, latestProductionRatePaise } from '@/selectors/register'
import { runSaveDispatchBatch, type DispatchBatchLine } from '@/store/registerCommands'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, EmptyState, SearchableDropdown } from '@/components/ui'

interface LineState {
  key: string
  bill: string
  ok: string
  mc: string
  mf: string
  rate: string
}

let _seq = 0
const newLine = (rate = ''): LineState => ({ key: `ln-${_seq++}`, bill: '', ok: '', mc: '', mf: '', rate })
const numOf = (v: string): number => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? n : 0
}
/** Ring quantities are whole numbers — round so a typo/paste decimal can't reach stock. */
const intOf = (v: string): number => {
  const n = Math.round(Number(v))
  return Number.isFinite(n) && n > 0 ? n : 0
}
const intFmt = (n: number) => n.toLocaleString('en-IN')
const ZERO = 0 as Paise

export default function OutwardEntry() {
  const can = useCan()
  const canCreate = can('dispatch', 'create')
  const openRows = useStore(useShallow(selectOpenInwardRows))
  const unitsById = useStore((s) => s.masters.units.byId)

  const [challanId, setChallanId] = useState('')
  const selected = openRows.find((r) => r.inward.id === challanId)
  const defaultRatePaise = useStore((s) =>
    selected ? latestProductionRatePaise(s, selected.inward.partId) : undefined
  )

  const [gst, setGst] = useState('')
  const [lines, setLines] = useState<LineState[]>([newLine()])
  const [submitting, setSubmitting] = useState(false)

  // Reset the form to a single line carrying THIS challan's part GST% + latest
  // production rate. Reads fresh store state so it never closes over a stale
  // part/rate; the fields stay manually editable afterwards.
  const resetForm = useCallback((inwardId: string) => {
    const s = useStore.getState()
    const row = selectInwardRows(s).find((r) => r.inward.id === inwardId)
    const p = row ? s.masters.parts.byId[row.inward.partId] : undefined
    const rate = row ? latestProductionRatePaise(s, row.inward.partId) : undefined
    setGst(p?.gstPct != null ? String(p.gstPct) : '18')
    setLines([newLine(rate != null ? String(fromPaise(rate)) : '')])
  }, [])

  // Keep the selection valid as challans drop out (e.g. after a save).
  useEffect(() => {
    if (openRows.length === 0) return
    if (!openRows.some((r) => r.inward.id === challanId)) setChallanId(openRows[0]!.inward.id)
  }, [openRows, challanId])

  // Reset the form whenever the parent challan changes.
  useEffect(() => {
    if (challanId) resetForm(challanId)
  }, [challanId, resetForm])

  const gstPct = numOf(gst)

  const computed = useMemo(() => {
    const rows = lines.map((ln) => {
      const ok = intOf(ln.ok)
      const mc = intOf(ln.mc)
      const mf = intOf(ln.mf)
      const ratePaise = ln.rate ? toPaise(Number(ln.rate)) : ZERO
      const total = ok + mc + mf
      const sub = mulQty(ratePaise, ok)
      const igst = pctOfPaise(sub, gstPct)
      const grand = addP(sub, igst)
      return { ok, mc, mf, total, sub, igst, grand }
    })
    const totals = rows.reduce(
      (a, r) => ({
        ok: a.ok + r.ok,
        mc: a.mc + r.mc,
        mf: a.mf + r.mf,
        total: a.total + r.total,
        sub: addP(a.sub, r.sub),
        igst: addP(a.igst, r.igst),
        grand: addP(a.grand, r.grand),
      }),
      { ok: 0, mc: 0, mf: 0, total: 0, sub: ZERO, igst: ZERO, grand: ZERO }
    )
    return { rows, totals }
  }, [lines, gstPct])

  const available = selected?.available ?? 0
  const over = computed.totals.total > available

  function setLine(key: string, patch: Partial<LineState>) {
    setLines((prev) => prev.map((ln) => (ln.key === key ? { ...ln, ...patch } : ln)))
  }
  function removeLine(key: string) {
    setLines((prev) => (prev.length > 1 ? prev.filter((ln) => ln.key !== key) : prev))
  }

  function onSave() {
    if (!selected) return
    const today = todayISO()
    const batchLines: DispatchBatchLine[] = lines
      .map((ln) => {
        const ok = intOf(ln.ok)
        const mc = intOf(ln.mc)
        const mf = intOf(ln.mf)
        if (ok + mc + mf <= 0) return null
        const rate = ln.rate ? Number(ln.rate) : 0
        const billed = rate > 0 && ok > 0
        const line: DispatchBatchLine = {
          kind: billed ? 'billed' : 'rejection',
          okQty: ok,
          mcRejQty: mc,
          mfQty: mf,
          billNo: ln.bill.trim() || undefined,
          billDate: billed ? today : undefined,
          dispatchDate: today,
          ratePaise: billed ? toPaise(rate) : undefined,
        }
        return line
      })
      .filter((x): x is DispatchBatchLine => x !== null)

    if (batchLines.length === 0) {
      toastCommandError(new Error('Add at least one line with a quantity'))
      return
    }
    setSubmitting(true)
    try {
      const res = runSaveDispatchBatch({ inwardId: selected.inward.id, lines: batchLines })
      toastCommandSuccess('Dispatch saved & stock updated', res.cascade)
      resetForm(selected.inward.id)
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  const unitName = selected ? unitsById[selected.inward.unitId]?.name ?? '—' : '—'

  if (openRows.length === 0) {
    return (
      <div className="space-y-4">
        <PageHead unit="—" />
        <Card>
          <EmptyState
            icon={ArrowUpFromLine}
            title="No open challans"
            description="Every challan in your scope is fully dispatched. Record an inward challan first."
          />
        </Card>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <PageHead unit={unitName} />

      <div className="rounded-lg border border-primary/30 bg-primary/10 px-3.5 py-2.5 text-[12px] text-primary">
        Select a parent inward challan, then add one or more dispatch lines. Each line carries its own qty
        breakdown, rate and GST — totals recalc live and validate against available stock.
      </div>

      {/* Reference card */}
      <Card className="p-0">
        <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Reference — parent inward challan</div>
        <div className="p-4">
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
            <Fld label="Ref D/C no (inward challan)">
              <SearchableDropdown
                aria-label="Ref D/C no (inward challan)"
                value={selected?.inward.id ?? ''}
                onChange={(v) => setChallanId(v)}
                options={openRows.map((r) => ({ value: r.inward.id, label: r.inward.challanNo, subtitle: `${r.partNo} · ${r.inward.challanDate}` }))}
              />
            </Fld>
            <Fld label="Part no (auto)">
              <input value={selected?.partNo ?? ''} disabled className="input h-9" />
            </Fld>
            <Fld label="Heat no (auto)">
              <input value={selected?.inward.batchHeatNo ?? ''} disabled className="input h-9" />
            </Fld>
            <Fld label="GST % (auto)">
              {/* GST is the part master's rate and is what the issued invoice uses — show it
                  read-only so the live preview can't diverge from the saved tax. */}
              <input type="number" value={gst} disabled className="input h-9" />
            </Fld>
          </div>
          <div className="mt-3.5 flex flex-wrap gap-x-6 gap-y-1.5 border-t border-border pt-3 text-[12.5px]">
            <span className="text-muted-fg">Received: <b className="text-fg">{intFmt(selected?.received ?? 0)}</b></span>
            <span className="text-muted-fg">Already dispatched: <b className="text-fg">{intFmt(selected?.dispatched ?? 0)}</b></span>
            <span className="text-primary">Available stock: <b>{intFmt(available)}</b></span>
          </div>
        </div>
      </Card>

      {/* Dispatch lines */}
      <Card className="overflow-x-auto p-0">
        <div className="border-b border-border px-4 py-3 text-[13px] font-semibold">Dispatch lines</div>
        <table className="w-full text-[12px]" aria-label="Dispatch lines">
          <thead>
            <tr className="bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
              <th scope="col" className="px-3 py-2 font-semibold" style={{ width: 150 }}>Bill / DC no</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">OK qty</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">M/C rej</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">MF</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Total</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Rate ₹</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Sub amt</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">IGST</th>
              <th scope="col" className="px-3 py-2 text-right font-semibold">Grand</th>
              <th scope="col" className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {lines.map((ln, i) => {
              const c = computed.rows[i]!
              return (
                <tr key={ln.key} className="border-t border-border/60">
                  <td className="px-2 py-1.5">
                    <input
                      value={ln.bill}
                      onChange={(e) => setLine(ln.key, { bill: e.target.value })}
                      placeholder="Bill / DC"
                      aria-label={`Line ${i + 1} bill or DC no`}
                      className="cell-input text-left"
                    />
                  </td>
                  <td className="px-2 py-1.5"><CellNum value={ln.ok} onChange={(v) => setLine(ln.key, { ok: v })} label={`Line ${i + 1} OK qty`} /></td>
                  <td className="px-2 py-1.5"><CellNum value={ln.mc} onChange={(v) => setLine(ln.key, { mc: v })} label={`Line ${i + 1} machine reject`} /></td>
                  <td className="px-2 py-1.5"><CellNum value={ln.mf} onChange={(v) => setLine(ln.key, { mf: v })} label={`Line ${i + 1} material fault`} /></td>
                  <td className="px-3 py-1.5 text-right mono font-semibold">{intFmt(c.total)}</td>
                  <td className="px-2 py-1.5"><CellNum value={ln.rate} onChange={(v) => setLine(ln.key, { rate: v })} label={`Line ${i + 1} rate`} step="0.01" /></td>
                  <td className="px-3 py-1.5 text-right mono text-muted-fg">{formatINRSymbol(c.sub)}</td>
                  <td className="px-3 py-1.5 text-right mono text-muted-fg">{formatINRSymbol(c.igst)}</td>
                  <td className="px-3 py-1.5 text-right mono font-semibold">{formatINRSymbol(c.grand)}</td>
                  <td className="px-2 py-1.5 text-right">
                    <button
                      type="button"
                      onClick={() => removeLine(ln.key)}
                      disabled={lines.length === 1}
                      aria-label={`Remove line ${i + 1}`}
                      className="btn btn-ghost h-7 w-7 p-0 text-faint hover:text-danger disabled:opacity-40"
                    >
                      <X size={14} />
                    </button>
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr className="border-t border-border bg-muted font-bold">
              <td className="px-3 py-2.5">Totals</td>
              <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.ok)}</td>
              <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.mc)}</td>
              <td className="px-3 py-2.5 text-right mono">{intFmt(computed.totals.mf)}</td>
              <td className={`px-3 py-2.5 text-right mono ${over ? 'text-danger' : ''}`}>{intFmt(computed.totals.total)}</td>
              <td />
              <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(computed.totals.sub)}</td>
              <td className="px-3 py-2.5 text-right mono">{formatINRSymbol(computed.totals.igst)}</td>
              <td className="px-3 py-2.5 text-right mono text-primary">{formatINRSymbol(computed.totals.grand)}</td>
              <td />
            </tr>
          </tfoot>
        </table>
      </Card>

      {/* Form bar */}
      <div className="flex flex-wrap items-center gap-2.5">
        <Button
          variant="secondary"
          leftIcon={<Plus size={15} />}
          onClick={() => setLines((prev) => [...prev, newLine(defaultRatePaise != null ? String(fromPaise(defaultRatePaise)) : '')])}
        >
          Add dispatch line
        </Button>
        {canCreate ? (
          <Button leftIcon={<Save size={15} />} onClick={onSave} loading={submitting} disabled={over || computed.totals.total <= 0}>
            Save &amp; update stock
          </Button>
        ) : null}
        {over ? (
          <span className="ml-auto text-[12px] font-semibold text-warning">⚠ Total exceeds available stock</span>
        ) : null}
      </div>
    </div>
  )
}

function PageHead({ unit }: { unit: string }) {
  return (
    <div>
      <h1 className="text-xl font-bold tracking-tight">Add outward entry</h1>
      <p className="mt-0.5 text-[13px] text-muted-fg">Unit auto-tagged · {unit}</p>
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

function CellNum({
  value,
  onChange,
  label,
  step,
}: {
  value: string
  onChange: (v: string) => void
  label: string
  step?: string
}) {
  return (
    <input
      type="number"
      min={0}
      step={step}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label={label}
      className="cell-input text-right"
    />
  )
}
