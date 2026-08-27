import { useId } from 'react'
import { useForm, useController } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import type { Dispatch, Inward } from '@/types/domain'
import { toPaise, fromPaise } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { useStore } from '@/store'
import { runSaveDispatch, type DispatchInput } from '@/store/registerCommands'
import { selectAvailableForInward, dispatchTotalQty } from '@/selectors/stock'
import { latestProductionRatePaise } from '@/selectors/register'
import { toastCommandError, toastCommandSuccess } from '@/lib/commandToast'
import { Drawer, Button, Field, Input, SearchableDropdown } from '@/components/ui'

const num = (v: unknown): number | undefined => {
  if (v === '' || v === null || v === undefined) return undefined
  const n = Number(v)
  return Number.isNaN(n) ? undefined : n
}

const schema = z
  .object({
    kind: z.enum(['billed', 'rejection']),
    okQty: z.number().int().min(0).optional(),
    mcRejQty: z.number().int().min(0).optional(),
    mfQty: z.number().int().min(0).optional(),
    billNo: z.string().optional(),
    billDate: z.string().optional(),
    dispatchDate: z.string().optional(),
    rate: z.number().nonnegative().optional(),
    custInvoiceNo: z.string().optional(),
  })
  .superRefine((v, ctx) => {
    const total = (v.okQty ?? 0) + (v.mcRejQty ?? 0) + (v.mfQty ?? 0)
    if (total <= 0) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Enter at least one quantity', path: ['okQty'] })
    if (v.kind === 'billed') {
      if (!v.billNo?.trim()) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Required for a billed dispatch', path: ['billNo'] })
      if (!(v.rate && v.rate > 0)) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Required for a billed dispatch', path: ['rate'] })
    }
  })
type DispatchFormValues = z.infer<typeof schema>

export function DispatchForm({
  inward,
  existing,
  partNo,
  onClose,
}: {
  inward: Inward
  existing: Dispatch | null
  partNo: string
  onClose: () => void
}) {
  const baseAvailable = useStore((s) => selectAvailableForInward(s, inward.id))
  const defaultRate = useStore((s) => latestProductionRatePaise(s, inward.partId))
  // On edit, the row's own qty is "available" to it again.
  const available = existing ? baseAvailable + dispatchTotalQty(existing) : baseAvailable

  const { register, handleSubmit, watch, formState, control } = useForm<DispatchFormValues>({
    resolver: zodResolver(schema),
    defaultValues: existing
      ? {
          kind: existing.kind,
          okQty: existing.okQty,
          mcRejQty: existing.mcRejQty,
          mfQty: existing.mfQty,
          billNo: existing.billNo ?? '',
          billDate: existing.billDate ?? '',
          dispatchDate: existing.dispatchDate ?? '',
          rate: existing.rateSnapshotPaise != null ? fromPaise(existing.rateSnapshotPaise) : undefined,
          custInvoiceNo: existing.custInvoiceNo ?? '',
        }
      : {
          kind: 'billed',
          okQty: undefined,
          mcRejQty: undefined,
          mfQty: undefined,
          billNo: '',
          billDate: todayISO(),
          dispatchDate: todayISO(),
          rate: defaultRate != null ? fromPaise(defaultRate) : undefined,
          custInvoiceNo: '',
        },
  })

  const formId = useId()
  const kind = watch('kind')
  const { field: kindField } = useController({ name: 'kind', control })
  const total = (num(watch('okQty')) ?? 0) + (num(watch('mcRejQty')) ?? 0) + (num(watch('mfQty')) ?? 0)
  const over = total > available
  const err = (k: keyof DispatchFormValues) => {
    const m = formState.errors[k]?.message
    return typeof m === 'string' ? m : undefined
  }
  // Field renders the error <p> with id `${htmlFor}-error`; point the control at it.
  const descId = (k: keyof DispatchFormValues) => (err(k) ? `${String(k)}-error` : undefined)
  const numReg = (k: keyof DispatchFormValues) => register(k, { setValueAs: num })

  function onValid(v: DispatchFormValues) {
    const input: DispatchInput = {
      id: existing?.id,
      inwardId: inward.id,
      kind: v.kind,
      okQty: v.okQty ?? 0,
      mcRejQty: v.mcRejQty ?? 0,
      mfQty: v.mfQty ?? 0,
      billNo: v.billNo?.trim() || undefined,
      billDate: v.billDate || undefined,
      dispatchDate: v.dispatchDate || undefined,
      ratePaise: v.kind === 'billed' && v.rate != null ? toPaise(v.rate) : undefined,
      custInvoiceNo: v.custInvoiceNo?.trim() || undefined,
    }
    try {
      const res = runSaveDispatch(input)
      toastCommandSuccess(existing ? 'Dispatch updated' : 'Dispatch saved', res.cascade)
      onClose()
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={existing ? 'Edit dispatch' : 'Record dispatch'}
      description={`Challan ${inward.challanNo} · ${partNo}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={formState.isSubmitting} disabled={over || total <= 0}>
            {existing ? 'Save changes' : 'Save dispatch'}
          </Button>
        </>
      }
    >
      <form id={formId} onSubmit={handleSubmit(onValid)} className="space-y-4">
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm">
          <span className="text-muted">Available on this challan</span>
          <span className="mono font-semibold">{available.toLocaleString('en-IN')}</span>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Type" htmlFor="kind">
            <SearchableDropdown
              id="kind"
              value={kindField.value}
              onChange={(v) => kindField.onChange(v)}
              options={[
                { value: 'billed', label: 'Billed (job work out)' },
                { value: 'rejection', label: 'Rejection / return' },
              ]}
            />
          </Field>
          <Field
            label={kind === 'billed' ? 'Bill no.' : 'Rejection DC no.'}
            htmlFor="billNo"
            required={kind === 'billed'}
            error={err('billNo')}
            hint={kind === 'billed' ? 'Groups dispatches into one draft invoice' : undefined}
          >
            <Input id="billNo" {...register('billNo')} aria-invalid={err('billNo') ? true : undefined} aria-describedby={descId('billNo')} />
          </Field>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <Field label="OK qty" htmlFor="okQty" error={err('okQty')}>
            <Input id="okQty" type="number" min={0} aria-invalid={err('okQty') ? true : undefined} aria-describedby={descId('okQty')} {...numReg('okQty')} />
          </Field>
          <Field label="Machine-rej qty" htmlFor="mcRejQty" error={err('mcRejQty')}>
            <Input id="mcRejQty" type="number" min={0} {...numReg('mcRejQty')} />
          </Field>
          <Field label="RM-fault qty" htmlFor="mfQty" error={err('mfQty')}>
            <Input id="mfQty" type="number" min={0} {...numReg('mfQty')} />
          </Field>
        </div>

        <div className={`text-sm ${over ? 'text-danger' : 'text-muted'}`}>
          Total this dispatch: <span className="mono font-semibold">{total.toLocaleString('en-IN')}</span>
          {over ? ' — exceeds available!' : ` of ${available.toLocaleString('en-IN')}`}
        </div>

        {kind === 'billed' ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <Field label="Rate per piece (₹)" htmlFor="rate" required error={err('rate')} hint="Defaults to the latest production rate">
              <Input id="rate" type="number" step="0.01" min={0} aria-invalid={err('rate') ? true : undefined} aria-describedby={descId('rate')} {...register('rate', { setValueAs: num })} />
            </Field>
            <Field label="Customer invoice no." htmlFor="custInvoiceNo">
              <Input id="custInvoiceNo" {...register('custInvoiceNo')} />
            </Field>
            <Field label="Bill date" htmlFor="billDate">
              <Input id="billDate" type="date" {...register('billDate')} />
            </Field>
            <Field label="Dispatch date" htmlFor="dispatchDate">
              <Input id="dispatchDate" type="date" {...register('dispatchDate')} />
            </Field>
          </div>
        ) : (
          <Field label="Dispatch / return date" htmlFor="dispatchDate" className="sm:max-w-xs">
            <Input id="dispatchDate" type="date" {...register('dispatchDate')} />
          </Field>
        )}
      </form>
    </Drawer>
  )
}
