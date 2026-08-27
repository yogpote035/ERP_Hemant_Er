import { useMemo, useState, type ReactNode } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { PackageX, Plus, Pencil, Trash2 } from 'lucide-react'
import { formatDMY, todayISO } from '@/lib/date'
import type { RejectionAdvice as RejectionAdviceEntity, RejectionWeightBasis } from '@/types/domain'
import { useStore } from '@/store'
import { customerOptions } from '@/masters/options'
import { getById } from '@/store/normalized'
import { scopedInwards } from '@/store/scope'
import { runSaveRejectionAdvice, runDeleteRejectionAdvice } from '@/store/scrapCommands'
import { selectRejectionRows } from '@/selectors/finance'
import { useCan } from '@/hooks/useCan'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Button, Card, ConfirmDialog, Drawer, EmptyState, SearchableDropdown } from '@/components/ui'

const intOf = (v: string) => {
  const n = Number(v)
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0
}

export default function RejectionAdvice() {
  const can = useCan()
  const rows = useStore(useShallow(selectRejectionRows))
  const [creating, setCreating] = useState(false)
  const [editing, setEditing] = useState<RejectionAdviceEntity | null>(null)
  const [deleting, setDeleting] = useState<RejectionAdviceEntity | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  function onDelete() {
    if (!deleting) return
    setDeleteBusy(true)
    try {
      const res = runDeleteRejectionAdvice(deleting.id)
      toastCommandSuccess('Rejection advice deleted', res.cascade)
      setDeleting(null)
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start gap-3">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Rejection advice</h1>
          <p className="mt-0.5 text-[13px] text-muted-fg">Rejected-material delivery challans (weight = rejected pcs × per-ring weight).</p>
        </div>
        {can('rejection', 'create') ? (
          <Button className="ml-auto" leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New rejection DC</Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card><EmptyState icon={PackageX} title="No rejection advices" description="Raise a rejection DC for returned material." action={can('rejection', 'create') ? <Button leftIcon={<Plus size={15} />} onClick={() => setCreating(true)}>New rejection DC</Button> : undefined} /></Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-[13px]">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                <th scope="col" className="px-3 py-2.5 font-semibold">DC no</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Date</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Customer</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Part</th>
                <th scope="col" className="px-3 py-2.5 font-semibold">Source challan</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">MR</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">FR</th>
                <th scope="col" className="px-3 py-2.5 text-right font-semibold">Weight (kg)</th>
                <th scope="col" className="px-3 py-2.5 text-right"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.advice.id} className="border-b border-border/60 hover:bg-muted/40">
                  <td className="px-3 py-2.5 mono font-medium">{r.advice.rejDcNo}</td>
                  <td className="px-3 py-2.5 mono text-muted-fg">{formatDMY(r.advice.rejDate)}</td>
                  <td className="px-3 py-2.5">{r.customerName}</td>
                  <td className="px-3 py-2.5">{r.partNo}</td>
                  <td className="px-3 py-2.5 mono text-muted-fg">{r.challanNo}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.advice.mrQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono">{r.advice.frQty.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5 text-right mono font-semibold">{r.weightKg.toLocaleString('en-IN')}</td>
                  <td className="px-3 py-2.5">
                    <div className="flex items-center justify-end gap-1">
                      {can('rejection', 'edit') ? (
                        <Button size="sm" variant="ghost" aria-label={`Edit ${r.advice.rejDcNo}`} title="Edit" onClick={() => setEditing(r.advice)}><Pencil size={14} /></Button>
                      ) : null}
                      {can('rejection', 'delete') ? (
                        <Button size="sm" variant="ghost" className="text-danger hover:bg-danger/10" aria-label={`Delete ${r.advice.rejDcNo}`} title="Delete" onClick={() => setDeleting(r.advice)}><Trash2 size={14} /></Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {creating ? <RejectionForm onClose={() => setCreating(false)} /> : null}
      {editing ? <RejectionForm existing={editing} onClose={() => setEditing(null)} /> : null}
      <ConfirmDialog
        open={deleting != null}
        onClose={() => setDeleting(null)}
        onConfirm={onDelete}
        loading={deleteBusy}
        tone="danger"
        title="Delete rejection DC?"
        confirmLabel="Delete"
        message={
          deleting ? (
            <>Delete rejection challan <b>{deleting.rejDcNo}</b>? This can be undone from the toast.</>
          ) : null
        }
      />
    </div>
  )
}

function RejectionForm({ existing, onClose }: { existing?: RejectionAdviceEntity; onClose: () => void }) {
  const customers = useStore(customerOptions)
  const inwards = useStore(useShallow((s) => scopedInwards(s).map((i) => ({ id: i.id, label: i.challanNo, subtitle: getById(s.masters.parts, i.partId)?.partNo ?? '', unitId: i.unitId, partId: i.partId }))))
  const partsById = useStore((s) => s.masters.parts.byId)

  const [sourceInwardId, setSourceInwardId] = useState(existing?.sourceInwardId ?? '')
  const [customerId, setCustomerId] = useState(existing?.customerId ?? '')
  const [rejDcNo, setRejDcNo] = useState(existing?.rejDcNo ?? '')
  const [rejDate, setRejDate] = useState(existing?.rejDate ?? todayISO())
  const [mrQty, setMrQty] = useState(existing ? String(existing.mrQty) : '')
  const [frQty, setFrQty] = useState(existing ? String(existing.frQty) : '')
  const [weightBasis, setWeightBasis] = useState<RejectionWeightBasis>(existing?.weightBasis ?? 'finish')
  const [submitting, setSubmitting] = useState(false)

  const source = inwards.find((i) => i.id === sourceInwardId)
  // On edit the source challan resolves the unit+part; fall back to the saved row.
  const unitId = source?.unitId ?? existing?.unitId
  const partId = source?.partId ?? existing?.partId
  const part = partId ? partsById[partId] : undefined
  // On edit, keep the ORIGINAL per-ring weight snapshot unless the user switches basis —
  // otherwise re-saving an old DC would silently restate its recorded weight from the
  // part's CURRENT master weight (which may have changed since the advice was raised).
  const keepSnapshot = existing != null && weightBasis === existing.weightBasis
  const perRingMg = keepSnapshot
    ? existing.weightPerRingMg
    : part
      ? weightBasis === 'scrap'
        ? part.scrapWtMg
        : part.finishWtMg
      : 0
  const weightKg = useMemo(() => ((intOf(mrQty) + intOf(frQty)) * perRingMg) / 1000 / 1000, [mrQty, frQty, perRingMg])

  function onSave() {
    if (!unitId || !partId) return
    setSubmitting(true)
    try {
      const res = runSaveRejectionAdvice({
        id: existing?.id,
        unitId,
        customerId,
        partId,
        sourceInwardId,
        rejDcNo: rejDcNo.trim(),
        rejDate,
        mrQty: intOf(mrQty),
        frQty: intOf(frQty),
        weightBasis,
        weightPerRingMg: keepSnapshot ? existing.weightPerRingMg : undefined,
      })
      toastCommandSuccess(existing ? 'Rejection advice updated' : 'Rejection advice saved', res.cascade)
      onClose()
    } catch (e) {
      toastCommandError(e)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="md"
      title={existing ? 'Edit rejection advice' : 'New rejection advice'}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={onSave} loading={submitting} disabled={!sourceInwardId || !customerId || !rejDcNo.trim() || intOf(mrQty) + intOf(frQty) <= 0}>{existing ? 'Save changes' : 'Save DC'}</Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Fld label="Source challan">
          <SearchableDropdown
            aria-label="Source challan"
            value={sourceInwardId}
            onChange={(v) => setSourceInwardId(v)}
            options={inwards.map((i) => ({ value: i.id, label: i.label, subtitle: i.subtitle }))}
            placeholder="Select challan…"
          />
        </Fld>
        <Fld label="Customer">
          <SearchableDropdown
            aria-label="Customer"
            value={customerId}
            onChange={(v) => setCustomerId(v)}
            options={customers}
            placeholder="Select customer…"
          />
        </Fld>
        <Fld label="Rejection DC no"><input className="input h-9" value={rejDcNo} onChange={(e) => setRejDcNo(e.target.value)} /></Fld>
        <Fld label="Date"><input type="date" className="input h-9" value={rejDate} onChange={(e) => setRejDate(e.target.value)} /></Fld>
        <Fld label="MR qty"><input type="number" min={0} className="input h-9" value={mrQty} onChange={(e) => setMrQty(e.target.value)} /></Fld>
        <Fld label="FR qty"><input type="number" min={0} className="input h-9" value={frQty} onChange={(e) => setFrQty(e.target.value)} /></Fld>
        <Fld label="Weight basis">
          <SearchableDropdown
            aria-label="Weight basis"
            value={weightBasis}
            onChange={(v) => setWeightBasis(v as RejectionWeightBasis)}
            options={[{ value: 'finish', label: 'Finish weight' }, { value: 'scrap', label: 'Scrap weight' }]}
          />
        </Fld>
        <Fld label="Computed weight">
          <input className="input h-9" disabled value={`${weightKg.toLocaleString('en-IN')} kg`} />
        </Fld>
      </div>
      {part ? (
        <p className="mt-3 text-[11px] text-faint">
          {part.partNo}: {weightBasis} weight {perRingMg.toLocaleString('en-IN')} mg/pc
        </p>
      ) : null}
    </Drawer>
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
