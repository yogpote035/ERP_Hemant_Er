# HEW ERP — Frontend v2 (Lovable-mock layout)

This is a re-skin of the v1 frontend to the client's **Lovable mock**
(`docs/lovable-mock-ui-spec.md`). **All business logic is reused verbatim** —
the Zustand store, selectors, command bus, masters, UI primitives, PDF/Excel and
the import wizard are the same code as v1. Only the **presentation layer** (nav,
router, brand chrome, login, dashboard, and the Materials/Vendors/Settings
screens) was rebuilt to follow the mock.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # type-checks + production build (green)
node scripts/shoot2.mjs   # Playwright visual check → scripts/shots2/
```

## What changed vs v1

| Area | v2 |
|------|----|
| **Sidebar** | Flat 10-item rail in the mock's order, HEMANT ENGINEERING WORKS brand block + ISO 9001:2015 / GST Compliant badges. |
| **Topbar** | Breadcrumb (`Operations / Dashboard`), search, undo/redo, unit switcher, theme, **Settings gear**, user chip. |
| **Footer** | `© 2026 Hemant Engineering Works · Pune, MH · ERP v4.2 · GSTIN 27AABCH1234E1Z5`. |
| **Login** | Two-panel hero (headline + 12+ yrs / 47 vendors / ₹14.2 Cr stats + TLS/ISO/GST trust line) and a sign-in card. Demo identity switch (no passwords) + "Skip to dashboard". |
| **Dashboard** | 8 KPI cards, Revenue vs Expenses / Revenue by Customer / Available Stock by Material charts, and Pending Payments / Recent Inward / Latest Invoices tables — all wired to the **real store**. |
| **Raw Material Master** (`/materials`) | Dedicated parts screen (reuses the Part master CRUD) + Export. |
| **Vendor Management** (`/vendors`) | 4 stat cards (Active / On Hold / GST Verified / RM) + vendor CRUD + Export. |
| **Material Inward** (`/inward`) | The v1 register; **Import is now a drawer** (the full MIO wizard, embedded) instead of a separate page. |
| **Settings** (`/settings`) | New 5-tab screen: Company (Units editor), Invoicing summary, Users, Roles, Backup (export / restore / reset). |

## Route map

`/` → `/dashboard`. Primary rail: `/dashboard /materials /vendors /inward
/outward /inventory /billing /expenses /reports /settings`.

The other functional v1 screens stay reachable by deep-link / in-app links
(not on the rail): `/masters` (full entity tabs), `/rates`, `/import`,
`/payments`, `/scrap`, `/rejection`, `/attendance`, `/users`.

The single source of truth is `src/app/nav.ts` (`SIDEBAR_ITEMS` +
`EXTRA_ROUTES`); the router and breadcrumbs are generated from it.

## Notes

- Mock seed numbers (1284 MT, Tata Steel, etc.) are **not** hardcoded — every
  figure is derived from the live in-memory store, so the screens stay correct
  as data changes.
- The Outward / Inventory / Billing / Expenses / Reports screens are the v1
  functional pages mounted at the new routes; they can be further re-skinned to
  the exact mock KPI labels if desired.
