import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

// Apply the saved/system theme before first paint (avoids a flash).
initTheme()
// Remove everything written by older browser-persistent builds. The application
// no longer writes to localStorage; PostgreSQL is the sole persistence layer.
localStorage.clear()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>
)
