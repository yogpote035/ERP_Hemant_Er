import { useId, useMemo, useState, type ReactNode } from 'react'
import { FormProvider, useForm, type FieldValues } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useShallow } from 'zustand/react/shallow'
import { Pencil, Plus, Trash2, RotateCcw, Search, X } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { allowedUnitIds } from '@/store/scope'
import { toastCommandError } from '@/lib/commandToast'
import { useCan } from '@/hooks/useCan'
import { AutoField } from '@/components/form/AutoField'
import { Button, Card, ConfirmDialog, Drawer, EmptyState, TablePager } from '@/components/ui'
import { usePagedSource } from '@/hooks/usePagedSource'

/** Master spec key → its `/masters/:entity` segment (server-side DB pagination). */
const MASTER_SEGMENT: Record<string, string> = {
  unit: 'units', customer: 'customers', vendor: 'vendors', part: 'parts',
  machine: 'machines', operation: 'operations', employee: 'employees', opening: 'stock-openings',
}
import type { BaseEntity, MasterView, RenderHelpers } from './types'

/** Generic master manager: scoped list + create/edit modal + (soft) delete.
 *  `actions` renders extra buttons (e.g. Export) next to "New …" on the toolbar. */
export function EntityManager({ spec, actions }: { spec: MasterView; actions?: ReactNode }) {
  const can = useCan()
  const canCreate = can(spec.module, 'create')
  const canEdit = can(spec.module, 'edit')
  const canDelete = can(spec.module, 'delete')

  // useShallow: these selectors build a fresh array/Set each call, so without a
  // shallow equality check the always-listening manager would re-render on every
  // unrelated store write (incl. activity-log appends).
  const allRows = useStore(useShallow(spec.selectRows))
  const allowed = useStore(useShallow(allowedUnitIds))
  const scopedRows = useMemo(
    () => (spec.unitScoped ? allRows.filter((r) => r.unitId != null && allowed.has(r.unitId)) : allRows),
    [allRows, allowed, spec]
  )
  // Server-driven in API mode. Successful writes trigger refreshAllData only
  // after the backend responds, avoiding stale GET-vs-PUT races.
  const paged = usePagedSource({
    localRows: scopedRows,
    endpoint: MASTER_SEGMENT[spec.key] ? `/masters/${MASTER_SEGMENT[spec.key]}` : '',
    searchText: spec.searchText,
    pageSize: 25,
  })
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
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <p className="text-sm text-muted">
            {paged.total} {paged.total === 1 ? spec.label.toLowerCase() : spec.labelPlural.toLowerCase()}
          </p>
          {spec.searchText && scopedRows.length > 0 ? (
            <div className="relative">
              <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-fg" />
              <input
                type="text"
                value={paged.search}
                onChange={(e) => paged.setSearch(e.target.value)}
                placeholder={spec.searchPlaceholder ?? 'Search…'}
                aria-label={`Search ${spec.labelPlural.toLowerCase()}`}
                className="h-9 w-72 sm:w-80 rounded-md border border-border bg-card pl-8 pr-7 text-[13px] text-fg placeholder:text-muted-fg focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              />
              {paged.search !== '' ? (
                <button
                  type="button"
                  onClick={() => paged.setSearch('')}
                  aria-label="Clear search"
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-fg hover:bg-muted"
                >
                  <X size={13} />
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {actions}
          {canCreate && scopedRows.length > 0 ? (
            <Button size="sm" leftIcon={<Plus size={15} />} onClick={() => setEditing({ row: null })}>
              New {spec.label}
            </Button>
          ) : null}
        </div>
      </div>

      {scopedRows.length === 0 ? (
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
      ) : paged.total === 0 ? (
        <Card>
          <EmptyState
            icon={Search}
            title="No matches"
            description={`No ${spec.labelPlural.toLowerCase()} match “${paged.search.trim()}”.`}
            action={
              <Button variant="secondary" onClick={() => paged.setSearch('')}>
                Clear search
              </Button>
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
              {paged.pageRows.map((row) => {
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
          <TablePager page={paged.page} pageCount={paged.pageCount} total={paged.total} pageSize={paged.pageSize} onPage={paged.setPage} onPageSize={paged.setPageSize} />
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
