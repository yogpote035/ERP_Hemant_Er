/**
 * The command-bus (plan §2.8). Every multi-collection write goes through
 * `runCommand`, which is:
 *   - authorized   — assert can() BEFORE touching state, and again inside apply
 *   - validated    — validate() runs on a read-only state; failure mutates nothing
 *   - atomic       — all mutations in ONE produceWithPatches set
 *   - undoable     — forward + inverse patches pushed to the in-memory undo stack
 *   - observable   — returns a structured CommandResult that drives a rich toast
 *   - logged       — appends one frozen ActivityLog entry
 */
import { applyPatches, enablePatches, produceWithPatches } from 'immer'
import type { ActivityLogEntry, Id, User } from '@/types/domain'
import { can, type Action, type Module } from '@/types/rbac'
import { newId } from '@/lib/id'
import { toISODate } from '@/lib/date'
import { currentUser, useStore } from './index'
import type { RootState } from './state'
import {
  CommandDeniedError,
  CommandValidationError,
  type CommandName,
  type CommandResult,
} from './commands'

enablePatches()

const UNDO_DEPTH = 20
const ACTIVITY_CAP = 5000

export interface CommandContext {
  actor: User
  /** Wall-clock instant as a UTC ISO timestamp (audit log / createdAt). */
  now: string
  /** LOCAL calendar date as `yyyy-MM-dd` — use this for document dates/FY, never
   *  `now.slice(0,10)` (that is UTC and is a day behind for hours after IST midnight). */
  today: string
  newId: (prefix?: string) => string
}

/** What a command's apply() returns alongside its draft mutations. */
export interface ApplyOut<R> {
  result: R
  /** Cascade lines for the rich toast, e.g. ['stock −16,400', 'draft INV-…']. */
  cascade: string[]
  /** Frozen audit summary. */
  summary: string
  refs: { type: string; id: Id }[]
  unitId?: Id
}

export interface Command<I, R> {
  name: CommandName
  module: Module
  action: Action
  validate?(s: RootState, input: I, ctx: CommandContext): { ok: true } | { ok: false; errors: string[] }
  apply(draft: RootState, input: I, ctx: CommandContext): ApplyOut<R>
}

/** Dispatch a command. Throws CommandDeniedError / CommandValidationError. */
export function runCommand<I, R>(cmd: Command<I, R>, input: I): CommandResult<R> {
  const s = useStore.getState()
  const actor = currentUser(s)
  if (!can(actor, cmd.module, cmd.action)) throw new CommandDeniedError(`${cmd.module}:${cmd.action}`)
  const at = new Date()
  const ctx: CommandContext = { actor: actor as User, now: at.toISOString(), today: toISODate(at), newId }

  if (cmd.validate) {
    const v = cmd.validate(s, input, ctx)
    if (!v.ok) throw new CommandValidationError(v.errors)
  }

  let out: ApplyOut<R> | undefined
  const [next, patches, inversePatches] = produceWithPatches(s, (draft) => {
    // Defense in depth: re-assert inside the transaction.
    if (!can(actor, cmd.module, cmd.action)) throw new CommandDeniedError(cmd.name)
    out = cmd.apply(draft as RootState, input, ctx)
    const entry: ActivityLogEntry = {
      id: newId('act'),
      ts: ctx.now,
      userId: ctx.actor.id,
      unitId: out.unitId,
      command: cmd.name,
      summary: out.summary,
      refs: out.refs,
    }
    draft.system.activityLog.push(entry)
    const overflow = draft.system.activityLog.length - ACTIVITY_CAP
    if (overflow > 0) draft.system.activityLog.splice(0, overflow)
  })

  if (!out) throw new Error(`Command ${cmd.name} produced no result`)

  const undoRec = {
    id: newId('undo'),
    ts: ctx.now,
    command: cmd.name,
    patches: [...patches],
    inversePatches: [...inversePatches],
    summary: out.summary,
  }
  useStore.setState(
    { ...next, _undo: [...s._undo, undoRec].slice(-UNDO_DEPTH), _redo: [] },
    true
  )
  return { ok: true, data: out.result, cascade: out.cascade, undoId: undoRec.id }
}

/** Revert the last command. Returns the reverted command name, or null. */
export function undo(): { command: CommandName; summary: string } | null {
  const s = useStore.getState()
  const rec = s._undo.at(-1)
  if (!rec) return null
  const reverted = applyPatches(s, rec.inversePatches)
  useStore.setState(
    { ...reverted, _undo: s._undo.slice(0, -1), _redo: [...s._redo, rec].slice(-UNDO_DEPTH) },
    true
  )
  return { command: rec.command, summary: rec.summary }
}

/** Re-apply the last undone command. */
export function redo(): { command: CommandName; summary: string } | null {
  const s = useStore.getState()
  const rec = s._redo.at(-1)
  if (!rec) return null
  const reapplied = applyPatches(s, rec.patches)
  useStore.setState(
    { ...reapplied, _redo: s._redo.slice(0, -1), _undo: [...s._undo, rec].slice(-UNDO_DEPTH) },
    true
  )
  return { command: rec.command, summary: rec.summary }
}

export function canUndo(s: RootState): boolean {
  return s._undo.length > 0
}
export function canRedo(s: RootState): boolean {
  return s._redo.length > 0
}
