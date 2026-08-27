import { RouterProvider } from 'react-router-dom'
import { router } from './app/router'

/** Root — the data router owns auth gating, the app shell, and all pages. */
export default function App() {
  return <RouterProvider router={router} />
}
