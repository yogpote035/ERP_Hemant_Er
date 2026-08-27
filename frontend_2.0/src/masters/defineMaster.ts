import type { FieldValues } from 'react-hook-form'
import type { ZodType } from 'zod'
import { values } from '@/store/normalized'
import { runCommand } from '@/store/commandBus'
import { makeMasterCommands } from '@/store/masterCommands'
import type { BaseEntity, MasterConfig, MasterView } from './types'

/**
 * Turn a typed `MasterConfig<T, F>` into a render-ready `MasterView`. All the
 * `as T` casts are confined here and are sound: rows handed back to columns /
 * mappers always originate from the same `collection`. This is the only place
 * the entity type is erased, keeping the rest of the framework `any`-free.
 */
export function defineMaster<T extends BaseEntity, F extends FieldValues>(
  cfg: MasterConfig<T, F>
): MasterView {
  const cmds = makeMasterCommands<T, F>({
    module: cfg.module,
    label: cfg.label,
    idPrefix: cfg.idPrefix,
    softDelete: cfg.softDelete ?? false,
    unitScoped: cfg.unitScoped ?? false,
    collection: cfg.collection,
    schema: cfg.schema,
    toEntity: cfg.toEntity,
    displayName: cfg.displayName,
    extraValidate: cfg.extraValidate,
    afterUpsert: cfg.afterUpsert,
  })

  return {
    key: cfg.key,
    module: cfg.module,
    label: cfg.label,
    labelPlural: cfg.labelPlural,
    icon: cfg.icon,
    unitScoped: cfg.unitScoped ?? false,
    softDelete: cfg.softDelete ?? false,
    schema: cfg.schema as ZodType,
    columns: cfg.columns.map((c) => ({
      key: c.key,
      header: c.header,
      className: c.className,
      render: (row: BaseEntity, h) => c.render(row as T, h),
    })),
    fields: cfg.fields,
    searchText: cfg.searchText ? (row: BaseEntity) => cfg.searchText!(row as T) : undefined,
    searchPlaceholder: cfg.searchPlaceholder,
    selectRows: (s) => values(cfg.collection(s)),
    emptyForm: () => cfg.emptyForm() as FieldValues,
    toForm: (row: BaseEntity) => cfg.toForm(row as T),
    displayName: (row: BaseEntity) => cfg.displayName(row as T),
    save: (vals, existing) =>
      runCommand(existing ? cmds.update : cmds.create, {
        values: vals as F,
        existingId: existing ? existing.id : null,
      }),
    remove: (row) => runCommand(cmds.remove, { id: row.id }),
    // Reactivate → 'edit'; deactivate → 'delete' (via remove), so the two
    // directions keep their distinct permissions.
    setActive: (row, active) =>
      active ? runCommand(cmds.activate, { id: row.id }) : runCommand(cmds.remove, { id: row.id }),
  }
}
