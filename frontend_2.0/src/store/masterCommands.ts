/**
 * Generic master CRUD commands (plan §7 P1). Each master spec gets its own
 * create/update/remove/setActive commands with the right module + action baked
 * in, so the command-bus enforces `can()` per role exactly as for every other
 * write. create⇒'create', update/setActive⇒'edit', remove⇒'delete'.
 */
import type { FieldValues } from 'react-hook-form'
import type { ZodType } from 'zod'
import type { Id, Normalized } from '@/types/domain'
import type { Module } from '@/types/rbac'
import { getById, putEntity, removeEntity, patchEntity } from './normalized'
import { writableUnitIds } from './scope'
import type { RootState } from './state'
import type { Command, CommandContext } from './commandBus'
import type { BaseEntity, ToEntityCtx } from '@/masters/types'

export interface MasterCommandConfig<T extends BaseEntity, F extends FieldValues> {
  module: Module
  label: string
  idPrefix: string
  softDelete: boolean
  /** Unit-bearing master: writes are rejected unless the target unit is writable. */
  unitScoped: boolean
  collection: (s: RootState) => Normalized<T>
  /** Re-validated inside the command (defense-in-depth, beyond the form resolver). */
  schema: ZodType<F>
  toEntity: (values: F, ctx: ToEntityCtx<T>) => T
  displayName: (row: T) => string
  extraValidate?: (values: F, s: RootState, existingId: Id | null) => string | null
  /** Runs after a CREATE upsert (inside the transaction) — e.g. supersede prior rates. */
  afterUpsert?: (draft: RootState, entity: T) => void
  afterSave?: (draft: RootState, entity: T, ctx: { existing: T | null; today: string; newId: (prefix?: string) => string }) => void
}

export interface MasterCommands<F extends FieldValues> {
  create: Command<{ values: F; existingId: Id | null }, { id: Id }>
  update: Command<{ values: F; existingId: Id | null }, { id: Id }>
  remove: Command<{ id: Id }, { id: Id }>
  /** Reactivate a soft-deleted row (action 'edit'). Deactivation goes through `remove` ('delete'). */
  activate: Command<{ id: Id }, { id: Id }>
}

export function makeMasterCommands<T extends BaseEntity, F extends FieldValues>(
  cfg: MasterCommandConfig<T, F>
): MasterCommands<F> {
  const upsert = (
    draft: RootState,
    input: { values: F; existingId: Id | null },
    ctx: { now: string; today: string; actorId: Id; newId: (p?: string) => string },
    verb: 'created' | 'updated'
  ): { id: Id } => {
    const id = input.existingId ?? ctx.newId(cfg.idPrefix)
    const existing = input.existingId ? getById(cfg.collection(draft), input.existingId) ?? null : null
    const entity = cfg.toEntity(input.values, { id, now: ctx.now, actorId: ctx.actorId, existing })
    putEntity(cfg.collection(draft), entity)
    if (verb === 'created') cfg.afterUpsert?.(draft, entity)
    cfg.afterSave?.(draft, entity, { existing, today: ctx.today, newId: ctx.newId })
    return { id }
  }

  const validateValues = (
    s: RootState,
    input: { values: F; existingId: Id | null },
    ctx: CommandContext
  ): { ok: true } | { ok: false; errors: string[] } => {
    const r = cfg.schema.safeParse(input.values)
    if (!r.success) return { ok: false, errors: r.error.issues.map((i) => i.message) }
    // Unit-scoping is enforced HERE (the security boundary), not just in the UI:
    // reject a write whose target unit is outside the user's writable set.
    if (cfg.unitScoped) {
      const existing = input.existingId ? getById(cfg.collection(s), input.existingId) ?? null : null
      const entity = cfg.toEntity(input.values, {
        id: input.existingId ?? 'validate', now: ctx.now, actorId: ctx.actor.id, existing,
      })
      if (entity.unitId && !writableUnitIds(s).has(entity.unitId)) {
        return { ok: false, errors: [`You don't have access to that unit`] }
      }
    }
    const extra = cfg.extraValidate?.(input.values, s, input.existingId)
    return extra ? { ok: false, errors: [extra] } : { ok: true }
  }

  const create: Command<{ values: F; existingId: Id | null }, { id: Id }> = {
    name: 'saveMaster',
    module: cfg.module,
    action: 'create',
    validate: validateValues,
    apply(draft, input, ctx) {
      const { id } = upsert(draft, input, { now: ctx.now, today: ctx.today, actorId: ctx.actor.id, newId: ctx.newId }, 'created')
      const entity = getById(cfg.collection(draft), id) as T
      return {
        result: { id },
        cascade: [`${cfg.label} created`],
        summary: `Created ${cfg.label.toLowerCase()} “${cfg.displayName(entity)}”`,
        refs: [{ type: cfg.idPrefix, id }],
        unitId: entity.unitId,
      }
    },
  }

  const update: Command<{ values: F; existingId: Id | null }, { id: Id }> = {
    ...create,
    action: 'edit',
    apply(draft, input, ctx) {
      const { id } = upsert(draft, input, { now: ctx.now, today: ctx.today, actorId: ctx.actor.id, newId: ctx.newId }, 'updated')
      const entity = getById(cfg.collection(draft), id) as T
      return {
        result: { id },
        cascade: [`${cfg.label} updated`],
        summary: `Updated ${cfg.label.toLowerCase()} “${cfg.displayName(entity)}”`,
        refs: [{ type: cfg.idPrefix, id }],
        unitId: entity.unitId,
      }
    },
  }

  const remove: Command<{ id: Id }, { id: Id }> = {
    name: 'deleteEntity',
    module: cfg.module,
    action: 'delete',
    validate(s, input) {
      const row = getById(cfg.collection(s), input.id)
      if (!row) return { ok: false, errors: [`${cfg.label} not found`] }
      if (cfg.unitScoped && row.unitId && !writableUnitIds(s).has(row.unitId)) {
        return { ok: false, errors: ["You don't have access to that unit"] }
      }
      return { ok: true }
    },
    apply(draft, input) {
      const row = getById(cfg.collection(draft), input.id) as T
      const name = cfg.displayName(row)
      if (cfg.softDelete) {
        patchEntity(cfg.collection(draft), input.id, { active: false } as Partial<T>)
      } else {
        removeEntity(cfg.collection(draft), input.id)
      }
      return {
        result: { id: input.id },
        cascade: [cfg.softDelete ? `${cfg.label} deactivated` : `${cfg.label} deleted`],
        summary: `${cfg.softDelete ? 'Deactivated' : 'Deleted'} ${cfg.label.toLowerCase()} “${name}”`,
        refs: [{ type: cfg.idPrefix, id: input.id }],
        unitId: row.unitId,
      }
    },
  }

  // Reactivation is an EDIT. Deactivation is a DELETE — it goes through `remove`,
  // so the deactivate capability can't be reached with only the 'edit' permission.
  const activate: Command<{ id: Id }, { id: Id }> = {
    name: 'saveMaster',
    module: cfg.module,
    action: 'edit',
    validate(s, input) {
      const row = getById(cfg.collection(s), input.id)
      if (!row) return { ok: false, errors: [`${cfg.label} not found`] }
      if (cfg.unitScoped && row.unitId && !writableUnitIds(s).has(row.unitId)) {
        return { ok: false, errors: ["You don't have access to that unit"] }
      }
      return { ok: true }
    },
    apply(draft, input) {
      patchEntity(cfg.collection(draft), input.id, { active: true } as Partial<T>)
      const row = getById(cfg.collection(draft), input.id) as T
      return {
        result: { id: input.id },
        cascade: [`${cfg.label} reactivated`],
        summary: `Reactivated ${cfg.label.toLowerCase()} “${cfg.displayName(row)}”`,
        refs: [{ type: cfg.idPrefix, id: input.id }],
        unitId: row.unitId,
      }
    },
  }

  return { create, update, remove, activate }
}
