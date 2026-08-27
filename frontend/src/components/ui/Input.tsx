import { cloneElement, forwardRef, isValidElement, useId } from 'react'
import type { InputHTMLAttributes, ReactElement, ReactNode } from 'react'
import { cn } from '@/lib/cn'

/** Text input — the shared `.input` look; forwards ref for React Hook Form. */
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className, type, onWheel, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type={type}
        className={cn('input', className)}
        // Scroll-wheel must not silently change a focused number field (a real
        // hazard on dense finance forms) — blur it instead.
        onWheel={(e) => {
          if (type === 'number') (e.currentTarget as HTMLInputElement).blur()
          onWheel?.(e)
        }}
        {...rest}
      />
    )
  }
)

export interface FieldProps {
  label?: ReactNode
  htmlFor?: string
  error?: string
  hint?: ReactNode
  required?: boolean
  className?: string
  children: ReactNode
}

/** Props a control accepts when Field auto-wires it. */
interface WirableControl {
  id?: string
  'aria-invalid'?: boolean
  'aria-describedby'?: string
}

/**
 * Label + control + error/hint wrapper. If you don't pass `htmlFor`, Field
 * generates an id and injects it (plus aria-invalid / aria-describedby) onto a
 * single child control so the label and message are actually associated. Pass
 * `htmlFor` to wire the ids yourself instead. Error wins over hint.
 */
export function Field({ label, htmlFor, error, hint, required, className, children }: FieldProps) {
  const generatedId = useId()
  const id = htmlFor ?? generatedId
  const msgId = error ? `${id}-error` : hint ? `${id}-hint` : undefined

  // Auto-wire the child control only when the caller didn't take over via htmlFor.
  let control = children
  if (!htmlFor && isValidElement(children)) {
    const child = children as ReactElement<WirableControl>
    control = cloneElement(child, {
      id: child.props.id ?? id,
      'aria-invalid': error ? true : child.props['aria-invalid'],
      'aria-describedby': msgId ?? child.props['aria-describedby'],
    })
  }

  return (
    <div className={cn('space-y-1', className)}>
      {label ? (
        <label htmlFor={id} className="block text-sm font-medium">
          {label}
          {required ? <span className="text-danger"> *</span> : null}
        </label>
      ) : null}
      {control}
      {error ? (
        <p id={msgId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={msgId} className="text-xs text-muted">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
