import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

// Apply the saved/system theme before first paint (avoids a flash).
initTheme()
// Remove data written by older browser-persistent builds. Business records now
// live only on the backend; localStorage is retained only for theme + auth token.
localStorage.removeItem('hew-erp-v1')

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>
)
