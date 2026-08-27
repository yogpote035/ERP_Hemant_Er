import { useId, useMemo, useState } from 'react'
import { FormProvider, useForm, type FieldValues } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useShallow } from 'zustand/react/shallow'
import { Pencil, Plus, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { allowedUnitIds } from '@/store/scope'
import { toastCommandError } from '@/lib/commandToast'
import { useCan } from '@/hooks/useCan'
import { AutoField } from '@/components/form/AutoField'
import { Button, Card, ConfirmDialog, Drawer, EmptyState } from '@/components/ui'
import type { BaseEntity, MasterView, RenderHelpers } from './types'

/** Generic master manager: scoped list + create/edit modal + (soft) delete. */
export function EntityManager({ spec }: { spec: MasterView }) {
  const can = useCan()
  const canCreate = can(spec.module, 'create')
  const canEdit = can(spec.module, 'edit')
  const canDelete = can(spec.module, 'delete')

  // useShallow: these selectors build a fresh array/Set each call, so without a
  // shallow equality check the always-listening manager would re-render on every
  // unrelated store write (incl. activity-log appends).
  const allRows = useStore(useShallow(spec.selectRows))
  const allowed = useStore(useShallow(allowedUnitIds))
  const rows = useMemo(
    () => (spec.unitScoped ? allRows.filter((r) => r.unitId != null && allowed.has(r.unitId)) : allRows),
    [allRows, allowed, spec]
  )
  const helpers = useRenderHelpers()

  const [editing, setEditing] = useState<{ row: BaseEntity | null } | null>(null)
  const [deleting, setDeleting] = useState<BaseEntity | null>(null)

  function onDeleteConfirm() {
    if (!deleting) return
    try {
      const res = spec.remove(deleting) // the command handles soft vs hard delete
      toast.success(res.cascade[0] ?? 'Done')
    } catch (e) {
      toastCommandError(e)
    } finally {
      setDeleting(null)
    }
  }

  function reactivate(row: BaseEntity) {
    try {
      spec.setActive(row, true)
      toast.success(`${spec.label} reactivated`)
    } catch (e) {
      toastCommandError(e)
    }
  }

  const showActions = canEdit || canDelete

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {rows.length} {rows.length === 1 ? spec.label.toLowerCase() : spec.labelPlural.toLowerCase()}
        </p>
        {canCreate && rows.length > 0 ? (
          <Button size="sm" leftIcon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
            New {spec.label}
          </Button>
        ) : null}
      </div>

      {rows.length === 0 ? (
        <Card>
          <EmptyState
            icon={spec.icon}
            title={`No ${spec.labelPlural.toLowerCase()} yet`}
            description={canCreate ? `Add your first ${spec.label.toLowerCase()} to get started.` : 'Nothing to show in your scope.'}
            action={
              canCreate ? (
                <Button leftIcon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
                  New {spec.label}
                </Button>
              ) : undefined
            }
          />
        </Card>
      ) : (
        <Card className="overflow-x-auto p-0">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted text-left text-[10.5px] uppercase tracking-wide text-muted-fg">
                {spec.columns.map((c) => (
                  <th key={c.key} scope="col" className={`px-3 py-2.5 font-semibold ${c.className ?? ''}`}>
                    {c.header}
                  </th>
                ))}
                {showActions ? (
                  <th scope="col" className="px-3 py-2.5 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const inactive = row.active === false
                return (
                  <tr
                    key={row.id}
                    className={`border-b border-border/60 last:border-0 hover:bg-muted/50 ${inactive ? 'opacity-60' : ''}`}
                  >
                    {spec.columns.map((c) => (
                      <td key={c.key} className={`px-3 py-2.5 ${c.className ?? ''}`}>
                        {c.render(row, helpers)}
                      </td>
                    ))}
                    {showActions ? (
                      <td className="px-3 py-2.5">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit ? (
                            <button
                              type="button"
                              className="btn btn-ghost h-8 w-8 p-0"
                              aria-label={`Edit ${spec.displayName(row)}`}
                              onClick={() => setEditing({ row })}
                            >
                              <Pencil size={15} />
                            </button>
                          ) : null}
                          {spec.softDelete && inactive && canEdit ? (
                            <button
                              type="button"
                              className="btn btn-ghost h-8 w-8 p-0 text-success"
                              aria-label={`Reactivate ${spec.displayName(row)}`}
                              onClick={() => reactivate(row)}
                            >
                              <RotateCcw size={15} />
                            </button>
                          ) : null}
                          {canDelete && !(spec.softDelete && inactive) ? (
                            <button
                              type="button"
                              className="btn btn-ghost h-8 w-8 p-0 text-danger"
                              aria-label={`${spec.softDelete ? 'Deactivate' : 'Delete'} ${spec.displayName(row)}`}
                              onClick={() => setDeleting(row)}
                            >
                              <Trash2 size={15} />
                            </button>
                          ) : null}
                        </div>
                      </td>
                    ) : null}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}

      {editing !== null ? (
        <MasterFormModal
          key={editing.row?.id ?? '__new__'}
          spec={spec}
          existing={editing.row}
          onClose={() => setEditing(null)}
        />
      ) : null}

      <ConfirmDialog
        open={deleting !== null}
        onClose={() => setDeleting(null)}
        onConfirm={onDeleteConfirm}
        tone="danger"
        title={spec.softDelete ? `Deactivate ${spec.label.toLowerCase()}?` : `Delete ${spec.label.toLowerCase()}?`}
        confirmLabel={spec.softDelete ? 'Deactivate' : 'Delete'}
        message={
          deleting
            ? spec.softDelete
              ? `“${spec.displayName(deleting)}” will be hidden from pickers but kept for history. You can reactivate it later.`
              : `“${spec.displayName(deleting)}” will be permanently removed. This can be undone from the toolbar.`
            : ''
        }
      />
    </div>
  )
}

function MasterFormModal({
  spec,
  existing,
  onClose,
}: {
  spec: MasterView
  existing: BaseEntity | null
  onClose: () => void
}) {
  const formId = useId()
  const methods = useForm<FieldValues>({
    resolver: zodResolver(spec.schema),
    defaultValues: existing ? spec.toForm(existing) : spec.emptyForm(),
  })

  function onValid(values: FieldValues) {
    try {
      const res = spec.save(values, existing)
      toast.success(res.cascade[0] ?? 'Saved')
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
      title={`${existing ? 'Edit' : 'New'} ${spec.label}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" form={formId} loading={methods.formState.isSubmitting}>
            {existing ? 'Save changes' : `Create ${spec.label.toLowerCase()}`}
          </Button>
        </>
      }
    >
      <FormProvider {...methods}>
        <form id={formId} onSubmit={methods.handleSubmit(onValid)} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {spec.fields.map((f) => (
            <AutoField key={f.name} field={f} />
          ))}
        </form>
      </FormProvider>
    </Drawer>
  )
}

function useRenderHelpers(): RenderHelpers {
  const units = useStore((s) => s.masters.units.byId)
  const parts = useStore((s) => s.masters.parts.byId)
  const customers = useStore((s) => s.masters.customers.byId)
  const vendors = useStore((s) => s.masters.vendors.byId)
  const machines = useStore((s) => s.masters.machines.byId)
  const operations = useStore((s) => s.masters.operations.byId)
  return useMemo<RenderHelpers>(
    () => ({
      unitCode: (id) => (id ? units[id]?.code ?? '—' : '—'),
      unitName: (id) => (id ? units[id]?.name ?? '—' : '—'),
      partLabel: (id) => {
        const p = id ? parts[id] : undefined
        return p ? p.partNo : '—'
      },
      customerName: (id) => (id ? customers[id]?.name ?? '—' : '—'),
      vendorName: (id) => (id ? vendors[id]?.name ?? '—' : '—'),
      machineLabel: (id) => (id ? machines[id]?.machineNo ?? '—' : '—'),
      operationLabel: (id) => (id ? operations[id]?.code ?? '—' : '—'),
    }),
    [units, parts, customers, vendors, machines, operations]
  )
}
