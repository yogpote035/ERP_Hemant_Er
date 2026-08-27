import { useEffect, useRef, useState } from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'
import { apiEnabled, getToken } from './api/client'
import { restoreApiSession } from './api/session'

/** Root — the data router owns auth gating, the app shell, and all pages. */
export default function App() {
  // In API mode, a persisted token means a prior session we can silently restore
  // (the in-memory session is lost on reload). Gate the first paint on that probe.
  const [restoring, setRestoring] = useState(() => apiEnabled() && !!getToken())
  const ran = useRef(false)

  useEffect(() => {
    if (!restoring || ran.current) return
    ran.current = true
    restoreApiSession().finally(() => setRestoring(false))
  }, [restoring])

  if (restoring) return <BootSplash />
  return <RouterProvider router={router} />
}

/** Minimal centered splash shown only while an API session is being restored. */
function BootSplash() {
  return (
    <div className="grid min-h-screen place-items-center bg-bg">
      <div className="flex flex-col items-center gap-3 text-muted-fg">
        <span className="h-8 w-8 animate-spin rounded-full border-2 border-border border-t-primary" aria-hidden />
        <span className="text-[13px]">Restoring your session…</span>
      </div>
    </div>
  )
}
