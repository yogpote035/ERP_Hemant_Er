import { useEffect } from 'react'
import { Undo2, Redo2 } from 'lucide-react'
import { toast } from 'sonner'
import { useStore } from '@/store'
import { undo, redo, canUndo, canRedo } from '@/store/commandBus'
import { Tooltip } from '@/components/ui'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/i.test(navigator.userAgent)
const MOD = IS_MAC ? '⌘' : 'Ctrl'

/**
 * Global undo/redo for the LAST data action, wired to the command-bus' in-memory
 * patch stacks. Every create/edit/delete/import is one reversible step; the
 * tooltip names exactly what will be reverted, and {MOD}+Z / {MOD}+Shift+Z work
 * anywhere outside a text field.
 */
export function UndoRedo() {
  const undoable = useStore(canUndo)
  const redoable = useStore(canRedo)
  const nextUndo = useStore((s) => s._undo.at(-1)?.summary)
  const nextRedo = useStore((s) => s._redo.at(-1)?.summary)

  function doUndo() {
    const r = undo()
    if (r) toast.info('Undone', { description: r.summary })
  }
  function doRedo() {
    const r = redo()
    if (r) toast.info('Redone', { description: r.summary })
  }

  // Global keyboard shortcuts — ignored while typing in a field.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!(e.ctrlKey || e.metaKey)) return
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return
      const k = e.key.toLowerCase()
      if (k === 'z' && !e.shiftKey) {
        e.preventDefault()
        const r = undo()
        if (r) toast.info('Undone', { description: r.summary })
      } else if ((k === 'z' && e.shiftKey) || k === 'y') {
        e.preventDefault()
        const r = redo()
        if (r) toast.info('Redone', { description: r.summary })
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex items-center">
      <Tooltip content={undoable ? `Undo: ${nextUndo} (${MOD}+Z)` : `Nothing to undo (${MOD}+Z)`}>
        <button
          type="button"
          onClick={doUndo}
          disabled={!undoable}
          className="btn btn-ghost h-9 w-9 p-0"
          aria-label={undoable ? `Undo ${nextUndo}` : 'Undo (nothing to undo)'}
        >
          <Undo2 size={18} />
        </button>
      </Tooltip>
      <Tooltip content={redoable ? `Redo: ${nextRedo} (${MOD}+Shift+Z)` : `Nothing to redo (${MOD}+Shift+Z)`}>
        <button
          type="button"
          onClick={doRedo}
          disabled={!redoable}
          className="btn btn-ghost h-9 w-9 p-0"
          aria-label={redoable ? `Redo ${nextRedo}` : 'Redo (nothing to redo)'}
        >
          <Redo2 size={18} />
        </button>
      </Tooltip>
    </div>
  )
}
