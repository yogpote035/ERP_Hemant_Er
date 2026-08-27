import { toast } from 'sonner'
import { CommandDeniedError, CommandValidationError } from '@/store/commands'

/** Map a thrown command error to a friendly toast (validation lists the reasons). */
export function toastCommandError(e: unknown): void {
  if (e instanceof CommandValidationError) toast.error('Could not save', { description: e.errors.join('; ') })
  else if (e instanceof CommandDeniedError) toast.error('Not allowed', { description: 'Your role cannot perform this action.' })
  else toast.error('Something went wrong')
}

/** Rich success toast that shows the command's cascade lines (the "many effects"). */
export function toastCommandSuccess(title: string, cascade: string[]): void {
  toast.success(title, cascade.length ? { description: cascade.join(' · ') } : undefined)
}
