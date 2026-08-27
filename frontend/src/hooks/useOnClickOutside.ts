import { useEffect, useRef, type RefObject } from 'react'

/**
 * Call `handler` on a pointer/touch outside `ref` (for dropdowns/popovers).
 * Uses a latest-ref for the handler so an inline closure from the caller doesn't
 * tear down and re-add the listeners on every render — the effect depends only
 * on `ref`/`enabled`.
 */
export function useOnClickOutside<T extends HTMLElement>(
  ref: RefObject<T>,
  handler: () => void,
  enabled = true
): void {
  const handlerRef = useRef(handler)
  handlerRef.current = handler

  useEffect(() => {
    if (!enabled) return
    const onPointer = (e: MouseEvent | TouchEvent) => {
      const el = ref.current
      if (el && !el.contains(e.target as Node)) handlerRef.current()
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [ref, enabled])
}
