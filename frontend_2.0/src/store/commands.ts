/**
 * Command-bus vocabulary. Every multi-collection write is a named, atomic,
 * undoable, observable, logged transaction dispatched through `runCommand`
 * (see commandBus.ts once RootState exists). This file holds the shared
 * names/result types so domain.ts (activity log, undo record) can reference
 * them without a cycle.
 */

export const COMMAND_NAMES = [
  'saveInward',
  'saveOutwardDispatch',
  'finalizeInvoice',
  'editDraftInvoice',
  'voidInvoice',
  'recordPayment',
  'reversePayment',
  'saveScrapBill',
  'deleteScrapBill',
  'saveExpense',
  'recordExpensePayment',
  'deleteExpense',
  'saveRejectionAdvice',
  'deleteRejectionAdvice',
  'importMioWorkbook',
  'saveMaster',
  'deleteEntity',
  'createUser',
  'updateUser',
  'toggleUserActive',
  'setUserOverride',
  'createRole',
  'updateRolePermissions',
  'renameRole',
  'deleteRole',
  'resetRole',
  'saveProductionAttendance',
  'saveShiftAttendance',
  'deleteProductionAttendance',
  'deleteShiftAttendance',
  'importBackup',
  'undo',
  'redo',
] as const

export type CommandName = (typeof COMMAND_NAMES)[number]

/** Thrown by the bus when an action is denied or validation fails. */
export class CommandDeniedError extends Error {
  constructor(public detail: string) {
    super(`Command denied: ${detail}`)
    this.name = 'CommandDeniedError'
  }
}
export class CommandValidationError extends Error {
  constructor(public errors: string[]) {
    super(errors.join('; '))
    this.name = 'CommandValidationError'
  }
}

/** Structured result every command returns — drives the rich toast + undo token. */
export interface CommandResult<T> {
  ok: true
  data: T
  /** Human-readable cascade lines, e.g. ['stock −16,400', 'draft INV-…']. */
  cascade: string[]
  undoId: string
}
