import { toast } from 'sonner'
import { createElement } from 'react'
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

/** A success toast whose complete visible card acts as a navigation link. */
export function toastCommandSuccessLink(title: string, cascade: string[], onClick: () => void): void {
  toast.custom((id) => createElement(
    'button',
    {
      type: 'button',
      onClick: () => { toast.dismiss(id); onClick() },
      className: 'w-full rounded-lg border border-success/30 bg-card p-3 text-left shadow-lg transition hover:bg-success/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
      'aria-label': `${title}. Open Billing and Invoice`,
    },
    createElement('div', { className: 'text-[13px] font-semibold text-success' }, `✓ ${title}`),
    cascade.length ? createElement('div', { className: 'mt-1 text-[12px] text-muted-fg' }, cascade.join(' · ')) : null,
    createElement('div', { className: 'mt-2 text-[11px] font-semibold text-primary' }, 'Open Billing & Invoice →'),
  ), { duration: 8000 })
}
