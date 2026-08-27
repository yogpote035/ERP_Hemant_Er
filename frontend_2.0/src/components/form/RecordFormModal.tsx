import { useEffect, useId, type ReactNode } from 'react'
import { FormProvider, useForm, type FieldValues, type UseFormSetValue } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import type { ZodType } from 'zod'
import { Drawer, Button } from '@/components/ui'
import { toastCommandError } from '@/lib/commandToast'
import { AutoField } from './AutoField'
import type { FieldSpec } from '@/masters/types'

/**
 * A FieldSpec-driven create/edit modal for one-off records (e.g. an inward
 * challan). Mount it conditionally (and key it per record) so defaults refresh.
 * `onValid` does the runCommand + success toast + close; thrown command errors
 * are caught and toasted here, leaving the modal open to fix.
 */
export function RecordFormModal({
  onClose,
  title,
  fields,
  schema,
  defaultValues,
  submitLabel = 'Save',
  onValid,
  deriveOnChange,
  beforeFields,
}: {
  onClose: () => void
  title: string
  fields: FieldSpec[]
  schema: ZodType
  defaultValues: FieldValues
  submitLabel?: string
  onValid: (values: FieldValues) => void
  /** Called when a field changes — lets the caller auto-fill OTHER fields (e.g. fill
   *  RM rate/weight when a part is picked). Guard on `changed` to avoid feedback loops. */
  deriveOnChange?: (changed: string, values: FieldValues, setValue: UseFormSetValue<FieldValues>) => void
  beforeFields?: ReactNode
}) {
  const formId = useId()
  const methods = useForm<FieldValues>({ resolver: zodResolver(schema), defaultValues })

  useEffect(() => {
    if (!deriveOnChange) return
    const sub = methods.watch((values, { name }) => {
      if (name) deriveOnChange(name, values as FieldValues, methods.setValue)
    })
    return () => sub.unsubscribe()
  }, [deriveOnChange, methods])

  function submit(values: FieldValues) {
    try {
      onValid(values)
    } catch (e) {
      toastCommandError(e)
    }
  }

  return (
    <Drawer
      open
      onClose={onClose}
      size="lg"
      title={title}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={methods.formState.isSubmitting}>
            {submitLabel}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form id={formId} onSubmit={methods.handleSubmit(submit)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {beforeFields ? <div className="sm:col-span-2">{beforeFields}</div> : null}
          {fields.map((f) => (
            <AutoField key={f.name} field={f} />
          ))}
        </form>
      </FormProvider>
    </Drawer>
  )
}
