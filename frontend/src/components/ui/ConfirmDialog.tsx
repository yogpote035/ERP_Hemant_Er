import type { ReactNode } from 'react'
import { AlertTriangle, HelpCircle, Trash2 } from 'lucide-react'
import { Modal } from './Modal'
import { Button } from './Button'

export type ConfirmTone = 'danger' | 'warning' | 'info'

export interface ConfirmDialogProps {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  message: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  tone?: ConfirmTone
  loading?: boolean
}

const TONE_META: Record<ConfirmTone, { icon: typeof AlertTriangle; wrap: string }> = {
  danger: { icon: Trash2, wrap: 'bg-danger/15 text-danger' },
  warning: { icon: AlertTriangle, wrap: 'bg-warning/15 text-warning' },
  info: { icon: HelpCircle, wrap: 'bg-primary/15 text-primary' },
}

/** A controlled confirm/cancel dialog for destructive or significant actions. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  tone = 'danger',
  loading = false,
}: ConfirmDialogProps) {
  const { icon: Icon, wrap } = TONE_META[tone]
  return (
    <Modal
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      closeOnBackdrop={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant={tone === 'danger' ? 'danger' : 'primary'} onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="flex gap-3">
        <div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${wrap}`}>
          <Icon size={20} aria-hidden />
        </div>
        <div className="min-w-0 text-sm text-muted">{message}</div>
      </div>
    </Modal>
  )
}
