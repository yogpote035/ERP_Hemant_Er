import { lazy, type ReactElement } from 'react'
import { createBrowserRouter } from 'react-router-dom'
import type { Module } from '@/types/rbac'
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
const Masters = lazy(() => import('@/pages/Masters'))
const Rates = lazy(() => import('@/pages/Rates'))
const InwardRegister = lazy(() => import('@/pages/InwardRegister'))
const OutwardEntry = lazy(() => import('@/pages/OutwardEntry'))
const Stock = lazy(() => import('@/pages/Stock'))
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
 * Real screens, keyed by module. Everything not listed here renders a
 * phase-aware <Placeholder> from its nav entry. Register a page as each phase
 * ships, e.g. `inward: <InwardRegister />` — routing/guards need no other edit.
 */
const REAL_PAGES: Partial<Record<Module, ReactElement>> = {
  // dashboard is the index route (below).
  masters: <Masters />,
  rates: <Rates />,
  inward: <InwardRegister />,
  dispatch: <OutwardEntry />,
  stock: <Stock />,
  import: <ImportWizard />,
  billing: <Billing />,
  payments: <Payments />,
  scrap: <Scrap />,
  expenses: <Expenses />,
  rejection: <RejectionAdvice />,
  attendance: <Attendance />,
  reports: <Reports />,
  users: <Users />,
}

/** One guarded route per non-index nav entry. */
const moduleRoutes = ALL_NAV.filter((item) => item.to !== '/').map((item) => ({
  path: item.to,
  element: (
    <RequirePermission module={item.module}>
      {REAL_PAGES[item.module] ?? <Placeholder item={item} />}
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
          {
            index: true,
            element: (
              <RequirePermission module="dashboard">
                <Dashboard />
              </RequirePermission>
            ),
          },
          ...moduleRoutes,
          { path: '*', element: <NotFound /> },
        ],
      },
    ],
  },
])
