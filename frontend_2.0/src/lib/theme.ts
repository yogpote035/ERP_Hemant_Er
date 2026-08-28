/**
 * Theme — light/dark via a `.dark` class on <html> (Tailwind `darkMode: 'class'`).
 * Kept in memory for the current page only and applied before first paint.
 */
export type ThemeMode = 'light' | 'dark'

const THEME_KEY = 'hew-erp-theme'

export function getStoredTheme(): ThemeMode | null {
  const value = localStorage.getItem(THEME_KEY)
  return value === 'light' || value === 'dark' ? value : null
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
  localStorage.setItem(THEME_KEY, mode)
  applyTheme(mode)
}

/** Apply the resolved theme to <html> at boot; returns the applied mode. */
export function initTheme(): ThemeMode {
  const mode = resolveInitialTheme()
  applyTheme(mode)
  return mode
}
