/**
 * Config-driven masters framework (plan §7 P1). Each master entity is described
 * once as a `MasterConfig` (fields, columns, zod schema, form↔entity mapping);
 * `defineMaster` erases the entity type into a render-ready `MasterView` that the
 * generic <EntityManager> consumes. Adding a master = one spec, no new UI/route.
 */
import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { DefaultValues, FieldValues } from 'react-hook-form'
import type { ZodType } from 'zod'
import type { Module } from '@/types/rbac'
import type { Id, Normalized } from '@/types/domain'
import type { RootState } from '@/store/state'
import type { CommandResult } from '@/store/commands'

/** The minimum every master row exposes to the generic machinery. */
export interface BaseEntity {
  id: Id
  active?: boolean
  unitId?: Id
}

export interface SelectOption {
  value: string
  label: string
  /** Optional dimmed second line (record-backed pickers show a two-line option). */
  subtitle?: string
}

/** A form control. `name` is the form-value key (not necessarily an entity key). */
export type FieldSpec =
  | { kind: 'text'; name: string; label: string; required?: boolean; placeholder?: string; hint?: string; colSpan?: 1 | 2 }
  | { kind: 'textarea'; name: string; label: string; required?: boolean; rows?: number; hint?: string; colSpan?: 1 | 2 }
  | { kind: 'number'; name: string; label: string; required?: boolean; min?: number; max?: number; step?: number; hint?: string; colSpan?: 1 | 2 }
  | { kind: 'money'; name: string; label: string; required?: boolean; hint?: string; colSpan?: 1 | 2 } // entered in rupees
  | { kind: 'date'; name: string; label: string; required?: boolean; hint?: string; colSpan?: 1 | 2 }
  | {
      kind: 'select'
      name: string
      label: string
      required?: boolean
      options: SelectOption[] | ((s: RootState) => SelectOption[])
      placeholder?: string
      hint?: string
      colSpan?: 1 | 2
    }
  | { kind: 'checkbox'; name: string; label: string; hint?: string; colSpan?: 1 | 2 }

/** Cross-entity name lookups available to column renderers (built from the store). */
export interface RenderHelpers {
  unitCode: (id?: Id) => string
  unitName: (id?: Id) => string
  partLabel: (id?: Id) => string
  customerName: (id?: Id) => string
  vendorName: (id?: Id) => string
  machineLabel: (id?: Id) => string
  operationLabel: (id?: Id) => string
}

/** A typed column for the spec author. */
export interface ColumnSpec<T> {
  key: string
  header: string
  className?: string
  render: (row: T, h: RenderHelpers) => ReactNode
}

/** Erased column the generic table renders. */
export interface ColumnView {
  key: string
  header: string
  className?: string
  render: (row: BaseEntity, h: RenderHelpers) => ReactNode
}

/** Authoring shape — fully typed against the concrete entity `T` + form `F`. */
export interface MasterConfig<T extends BaseEntity, F extends FieldValues> {
  key: string
  module: Module
  label: string
  labelPlural: string
  icon: LucideIcon
  idPrefix: string
  /** List rows are filtered to the session's allowed units when true. */
  unitScoped?: boolean
  /** True ⇒ "delete" deactivates (active=false) and rows can be reactivated. */
  softDelete?: boolean
  collection: (s: RootState) => Normalized<T>
  columns: ColumnSpec<T>[]
  fields: FieldSpec[]
  /** Validates FORM values (rupees, joined text, etc.), not the stored entity. */
  schema: ZodType<F>
  /** Blank-form defaults (partial: required numbers may start empty). */
  emptyForm: () => DefaultValues<F>
  toForm: (row: T) => F
  toEntity: (values: F, ctx: ToEntityCtx<T>) => T
  displayName: (row: T) => string
  /** Cross-field / store-aware validation beyond zod; return an error to reject.
   *  `existingId` is the row being edited (null on create) so guards can exclude self. */
  extraValidate?: (values: F, s: RootState, existingId: Id | null) => string | null
  /** Runs inside the command transaction AFTER a CREATE upserts the new row —
   *  e.g. versioned rates supersede the prior current row. Edit/reactivate skip it. */
  afterUpsert?: (draft: RootState, entity: T) => void
}

export interface ToEntityCtx<T> {
  id: Id
  now: string
  actorId: Id
  existing: T | null
}

/** Type-erased, render-ready definition consumed by the UI + router. */
export interface MasterView {
  key: string
  module: Module
  label: string
  labelPlural: string
  icon: LucideIcon
  unitScoped: boolean
  softDelete: boolean
  columns: ColumnView[]
  fields: FieldSpec[]
  schema: ZodType
  selectRows: (s: RootState) => BaseEntity[]
  emptyForm: () => FieldValues
  toForm: (row: BaseEntity) => FieldValues
  displayName: (row: BaseEntity) => string
  /** Throws CommandDeniedError / CommandValidationError on failure. */
  save: (values: FieldValues, existing: BaseEntity | null) => CommandResult<{ id: Id }>
  remove: (row: BaseEntity) => CommandResult<{ id: Id }>
  setActive: (row: BaseEntity, active: boolean) => CommandResult<{ id: Id }>
}
