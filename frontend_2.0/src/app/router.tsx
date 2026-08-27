import { lazy, type ReactElement } from 'react'
import { createBrowserRouter, Navigate } from 'react-router-dom'
import { AppLayout } from '@/components/layout/AppLayout'
import { RequireAuth, RequirePermission } from './guards'
import { ALL_NAV } from './nav'
// Login stays eager (it is the entry paint, outside the Suspense frame).
// Placeholder + NotFound are tiny and shared, so they stay eager too.
import Login from '@/pages/Login'
import Placeholder from '@/pages/Placeholder'
import NotFound from '@/pages/NotFound'

// Every authenticated screen is code-split into its own chunk and loaded behind
// the <Suspense> boundary in AppLayout. This keeps the initial bundle small —
// the heavy form/PDF/xlsx code only downloads when its route is first visited.
const Dashboard = lazy(() => import('@/pages/Dashboard'))
const Materials = lazy(() => import('@/pages/Materials'))
const Vendors = lazy(() => import('@/pages/Vendors'))
const Customers = lazy(() => import('@/pages/Customers'))
const Settings = lazy(() => import('@/pages/Settings'))
const Masters = lazy(() => import('@/pages/Masters'))
const Rates = lazy(() => import('@/pages/Rates'))
const InwardRegister = lazy(() => import('@/pages/InwardRegister'))
const OutwardEntry = lazy(() => import('@/pages/OutwardEntry'))
const Inventory = lazy(() => import('@/pages/Inventory'))
const ImportWizard = lazy(() => import('@/pages/ImportWizard'))
const Billing = lazy(() => import('@/pages/Billing'))
const Payments = lazy(() => import('@/pages/Payments'))
const Scrap = lazy(() => import('@/pages/Scrap'))
const Expenses = lazy(() => import('@/pages/Expenses'))
const RejectionAdvice = lazy(() => import('@/pages/RejectionAdvice'))
const Attendance = lazy(() => import('@/pages/Attendance'))
const Reports = lazy(() => import('@/pages/Reports'))
const Users = lazy(() => import('@/pages/Users'))

/**
 * Real screens keyed by ROUTE PATH (not module) — several Lovable-mock routes
 * share the `masters` module (Materials, Vendors, Settings), so the page is
 * resolved by `to`. Anything missing falls back to a phase-aware Placeholder.
 */
const PAGE_BY_PATH: Record<string, ReactElement> = {
  '/dashboard': <Dashboard />,
  '/materials': <Materials />,
  '/vendors': <Vendors />,
  '/customers': <Customers />,
  '/inward': <InwardRegister />,
  '/outward': <OutwardEntry />,
  '/inventory': <Inventory />,
  '/billing': <Billing />,
  '/expenses': <Expenses />,
  '/reports': <Reports />,
  '/settings': <Settings />,
  '/machines': <Masters initialKey="machine" />,
  '/employees': <Masters initialKey="employee" />,
  // Non-sidebar functional routes, still reachable by deep-link.
  '/masters': <Masters />,
  '/rates': <Rates />,
  '/import': <ImportWizard />,
  '/payments': <Payments />,
  '/scrap': <Scrap />,
  '/rejection': <RejectionAdvice />,
  '/attendance': <Attendance />,
  '/users': <Users />,
}

/** One guarded route per nav entry (primary rail + extras). */
const moduleRoutes = ALL_NAV.map((item) => ({
  path: item.to,
  element: (
    <RequirePermission module={item.module}>
      {PAGE_BY_PATH[item.to] ?? <Placeholder item={item} />}
    </RequirePermission>
  ),
}))

export const router = createBrowserRouter([
  { path: '/login', element: <Login /> },
  {
    // Auth gate → app frame → permission-gated pages.
    element: <RequireAuth />,
    children: [
      {
        element: <AppLayout />,
        children: [
          // The mock's home is /dashboard; '/' lands there.
          { index: true, element: <Navigate to="/dashboard" replace /> },
          ...moduleRoutes,
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
