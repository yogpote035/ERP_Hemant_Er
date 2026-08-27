import { Moon, Sun } from 'lucide-react'
import { useTheme } from '@/hooks/useTheme'
import { Tooltip } from '@/components/ui'

/** Light/dark toggle button for the topbar. */
export function ThemeToggle() {
  const { mode, toggle } = useTheme()
  const isDark = mode === 'dark'
  return (
    <Tooltip content={isDark ? 'Switch to light' : 'Switch to dark'}>
      <button
        type="button"
        onClick={toggle}
        className="btn btn-ghost h-9 w-9 p-0"
        aria-label="Toggle theme"
      >
        {isDark ? <Sun size={18} /> : <Moon size={18} />}
      </button>
    </Tooltip>
  )
}
