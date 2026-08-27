import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { ensureSeeded } from './store/persistence'
import { initTheme } from './lib/theme'
import './index.css'

// Apply the saved/system theme before first paint (avoids a flash).
initTheme()
// Seed deterministic demo data on first load (no-op once seeded/persisted).
ensureSeeded()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>
)
