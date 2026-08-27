import { useCallback, useState } from 'react'
import { resolveInitialTheme, setTheme, type ThemeMode } from '@/lib/theme'

/** Reactive theme state for the toggle. Initial value matches what boot applied. */
export function useTheme(): { mode: ThemeMode; toggle: () => void; set: (m: ThemeMode) => void } {
  const [mode, setMode] = useState<ThemeMode>(() => resolveInitialTheme())

  const set = useCallback((m: ThemeMode) => {
    setTheme(m)
    setMode(m)
  }, [])

  // Keep the DOM side effect OUT of the state updater (StrictMode may invoke
  // updaters twice). Derive from the current value, then commit both.
  const toggle = useCallback(() => set(mode === 'dark' ? 'light' : 'dark'), [mode, set])

  return { mode, toggle, set }
}
