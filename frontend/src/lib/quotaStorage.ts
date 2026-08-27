/**
 * quotaStorage.ts (P9) — a localStorage wrapper for the Zustand persist layer.
 * If a write blows the ~5 MB quota, we WARN once (via a toast) instead of letting
 * the write silently fail; the app keeps running on in-memory state. The user is
 * nudged to export a backup + reset demo data.
 */
import { toast } from 'sonner'

let warned = false

export const quotaSafeStorage = {
  getItem: (name: string): string | null => {
    try {
      return localStorage.getItem(name)
    } catch {
      return null
    }
  },
  setItem: (name: string, value: string): void => {
    try {
      localStorage.setItem(name, value)
    } catch {
      // QuotaExceededError (or privacy-mode denial). Swallow so the app keeps
      // working on in-memory state; warn the user once per session.
      if (!warned) {
        warned = true
        toast.error('Local storage is full', {
          description: 'Recent changes may not be saved across refresh. Export a backup, then reset demo data.',
          duration: 8000,
        })
      }
    }
  },
  removeItem: (name: string): void => {
    try {
      localStorage.removeItem(name)
    } catch {
      /* ignore */
    }
  },
}
