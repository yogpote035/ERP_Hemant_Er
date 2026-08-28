import { useState } from 'react'
import { Lock, Unlock } from 'lucide-react'
import { useController, useFormContext, type FieldErrors } from 'react-hook-form'
import { useStore } from '@/store'
import { cn } from '@/lib/cn'
import { Field, Input, SearchableDropdown } from '@/components/ui'
import type { FieldSpec } from '@/masters/types'

function errMsg(errors: FieldErrors, name: string): string | undefined {
  const m = errors[name]?.message
  return typeof m === 'string' ? m : undefined
}

function colSpan(span?: 1 | 2): string {
  return span === 2 ? 'sm:col-span-2' : ''
}

/** The id of the message <p> Field renders, so controls can point aria-describedby at it. */
function describedBy(name: string, msg: string | undefined, hint: unknown): string | undefined {
  if (msg) return `${name}-error`
  return hint ? `${name}-hint` : undefined
}

/** Renders a single form control from a FieldSpec, wired to the RHF context. */
export function AutoField({ field }: { field: FieldSpec }) {
  switch (field.kind) {
    case 'text':
    case 'textarea':
      return <TextLike field={field} />
    case 'number':
    case 'money':
      return <NumberLike field={field} />
    case 'date':
      return <DateField field={field} />
    case 'select':
      return <SelectField field={field} />
    case 'checkbox':
      return <CheckboxField field={field} />
  }
}

function TextLike({ field }: { field: Extract<FieldSpec, { kind: 'text' | 'textarea' }> }) {
  const [locked, setLocked] = useState(field.kind === 'text' && field.lockable === true)
  const { register, formState } = useFormContext()
  const msg = errMsg(formState.errors, field.name)
  const desc = describedBy(field.name, msg, field.hint)
  return (
    <Field
      label={field.label}
      htmlFor={field.name}
      required={field.required}
      error={msg}
      hint={field.hint}
      className={colSpan(field.colSpan)}
    >
      {field.kind === 'textarea' ? (
        <textarea
          id={field.name}
          rows={field.rows ?? 3}
          className="input"
          aria-required={field.required || undefined} aria-invalid={msg ? true : undefined}
          aria-describedby={desc}
          {...register(field.name)}
        />
      ) : (
        <div className="flex gap-2">
          <Input
            id={field.name}
            placeholder={field.placeholder}
            readOnly={locked}
            aria-readonly={locked || undefined}
            aria-required={field.required || undefined} aria-invalid={msg ? true : undefined}
            aria-describedby={desc}
            className={locked ? 'cursor-not-allowed bg-muted/40 text-muted-fg' : undefined}
            {...register(field.name)}
          />
          {field.lockable ? (
            <button
              type="button"
              className="inline-flex shrink-0 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium text-fg hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setLocked((value) => !value)}
              aria-label={locked ? `Unlock ${field.label}` : `Lock ${field.label}`}
            >
              {locked ? <Unlock size={14} /> : <Lock size={14} />}
              {locked ? 'Unlock' : 'Lock'}
            </button>
          ) : null}
        </div>
      )}
    </Field>
  )
}

function NumberLike({ field }: { field: Extract<FieldSpec, { kind: 'number' | 'money' }> }) {
  const { register, formState } = useFormContext()
  const msg = errMsg(formState.errors, field.name)
  const desc = describedBy(field.name, msg, field.hint)
  const isMoney = field.kind === 'money'
  return (
    <Field
      label={isMoney ? `${field.label} (₹)` : field.label}
      htmlFor={field.name}
      required={field.required}
      error={msg}
      hint={field.hint}
      className={colSpan(field.colSpan)}
    >
      <Input
        id={field.name}
        type="number"
        inputMode="decimal"
        step={isMoney ? '0.01' : field.kind === 'number' ? field.step ?? 1 : 1}
        min={isMoney ? 0 : field.kind === 'number' ? field.min : undefined}
        max={field.kind === 'number' ? field.max : undefined}
        aria-required={field.required || undefined} aria-invalid={msg ? true : undefined}
        aria-describedby={desc}
        {...register(field.name, {
          // '' / non-numeric → undefined so optional numbers don't become NaN/0 and
          // required blanks are rejected by zod; otherwise a real number.
          setValueAs: (v) => {
            if (v === '' || v === null) return undefined
            const n = Number(v)
            return Number.isNaN(n) ? undefined : n
          },
        })}
      />
    </Field>
  )
}

function DateField({ field }: { field: Extract<FieldSpec, { kind: 'date' }> }) {
  const { register, formState } = useFormContext()
  const msg = errMsg(formState.errors, field.name)
  const desc = describedBy(field.name, msg, field.hint)
  return (
    <Field
      label={field.label}
      htmlFor={field.name}
      required={field.required}
      error={msg}
      hint={field.hint}
      className={colSpan(field.colSpan)}
    >
      <Input id={field.name} type="date" aria-required={field.required || undefined} aria-invalid={msg ? true : undefined} aria-describedby={desc} {...register(field.name)} />
    </Field>
  )
}

function SelectField({ field }: { field: Extract<FieldSpec, { kind: 'select' }> }) {
  const { control, formState } = useFormContext()
  const { field: ctl } = useController({ name: field.name, control })
  const msg = errMsg(formState.errors, field.name)
  const desc = describedBy(field.name, msg, field.hint)
  const options = useStore((s) => (typeof field.options === 'function' ? field.options(s) : field.options))
  // Preserve a stored value that isn't in the current options (e.g. a part whose
  // unit left scope, or a gstPct outside the preset list) so opening+saving the
  // record doesn't silently overwrite it.
  const current = String(ctl.value ?? '')
  const missing = current !== '' && !options.some((o) => o.value === current)
  const opts = [
    ...(missing ? [{ value: current, label: `${current} (current)` }] : []),
    ...options.map((o) => ({ value: o.value, label: o.label, subtitle: o.subtitle })),
  ]
  return (
    <Field
      label={field.label}
      htmlFor={field.name}
      required={field.required}
      error={msg}
      hint={field.hint}
      className={colSpan(field.colSpan)}
    >
      <SearchableDropdown
        id={field.name}
        value={current}
        onChange={(v) => ctl.onChange(v)}
        options={opts}
        placeholder={field.placeholder ?? '— select —'}
        clearable={!field.required}
        aria-required={field.required || undefined} aria-invalid={msg ? true : undefined}
        aria-describedby={desc}
      />
    </Field>
  )
}

function CheckboxField({ field }: { field: Extract<FieldSpec, { kind: 'checkbox' }> }) {
  const { register } = useFormContext()
  return (
    <label className={cn('flex cursor-pointer items-center gap-2 py-1 text-sm', colSpan(field.colSpan))}>
      <input
        type="checkbox"
        className="h-4 w-4 rounded border-border text-primary focus-visible:ring-2 focus-visible:ring-ring"
        {...register(field.name)}
      />
      <span>{field.label}</span>
      {field.hint ? <span className="text-xs text-muted">— {field.hint}</span> : null}
    </label>
  )
}
