/**
 * Theme — light/dark via a `.dark` class on <html> (Tailwind `darkMode: 'class'`).
 * Persisted to its own localStorage key (separate from the data store) and
 * applied before first paint to avoid a flash.
 */
export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'hew-erp-theme'

export function getStoredTheme(): ThemeMode | null {
  try {
    const v = localStorage.getItem(THEME_KEY)
    return v === 'dark' || v === 'light' ? v : null
  } catch {
    // Storage can throw in some privacy modes — degrade to "no preference".
    return null
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: dark)').matches
    : false
}

/** Stored preference, else the OS preference. */
export function resolveInitialTheme(): ThemeMode {
  return getStoredTheme() ?? (systemPrefersDark() ? 'dark' : 'light')
}

export function applyTheme(mode: ThemeMode): void {
  document.documentElement.classList.toggle('dark', mode === 'dark')
}

export function setTheme(mode: ThemeMode): void {
  try {
    localStorage.setItem(THEME_KEY, mode)
  } catch {
    // ignore — apply the theme for this session even if it can't be persisted
  }
  applyTheme(mode)
}

/** Apply the resolved theme to <html> at boot; returns the applied mode. */
export function initTheme(): ThemeMode {
  const mode = resolveInitialTheme()
  applyTheme(mode)
  return mode
}
