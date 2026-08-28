import React from 'react'
import ReactDOM from 'react-dom/client'
import { Toaster } from 'sonner'
import App from './App'
import { initTheme } from './lib/theme'
import './index.css'

// Remove legacy browser-persisted application/business data. Authentication is
// restored from the token; user identity and roles are re-fetched from the API.
const allowedStorageKeys = new Set(['hew_api_token', 'hew-erp-theme'])
for (const key of Object.keys(localStorage)) {
  if (!allowedStorageKeys.has(key)) localStorage.removeItem(key)
}

// Apply the saved/system theme before first paint (avoids a flash).
initTheme()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
    <Toaster richColors position="bottom-right" closeButton />
  </React.StrictMode>
)
