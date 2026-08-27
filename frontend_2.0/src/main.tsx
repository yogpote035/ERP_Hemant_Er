import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

// Apply the saved/system theme before first paint (avoids a flash).
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>
)
