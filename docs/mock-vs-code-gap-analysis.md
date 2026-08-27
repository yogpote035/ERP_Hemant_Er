# Gap Analysis & Frontend Update Plan

> Mock = the deployed Lovable spec ([lovable-mock-ui-spec.md](./lovable-mock-ui-spec.md)).
> Code = the current React frontend ([current-frontend-forms.md](./current-frontend-forms.md)).
> Goal: evolve the code toward the mock **where the mock is better**, while **keeping** the
> deeper real features the mock doesn't show.

## 1. Route comparison

| Mock page | Mock route | Code page | Code route | Status |
|-----------|-----------|-----------|-----------|--------|
| Dashboard | `/dashboard` | Dashboard | `/` | **match** (different path) |
| Raw Material Master | `/materials` | Masters → Parts tab | `/masters` | **diverged** (mock = standalone page; code = tab) |
| Vendor Management | `/vendors` | Masters → Vendors tab | `/masters` | **diverged** (mock = standalone page + stat cards) |
| Material Inward | `/inward` | Inward / Outward register | `/inward` | **match** (code merges inward+outward) |
| Material Outward / Dispatch | `/outward` | Outward entry / dispatch children | `/dispatch` | **diverged** (code = child of inward, not flat list) |
| Inventory Stock | `/inventory` | Stock | `/stock` | **match** (naming differs) |
| Billing & GST Invoices | `/billing` | Billing | `/billing` | **match** (code adds draft→finalize lifecycle) |
| Expense & Supplier Payments | `/expenses` | Expenses | `/expenses` | **match** |
| Reports & Analytics | `/reports` | Reports | `/reports` | **match** |
| Settings | `/settings` | — | — | **missing-in-code** |
| — | — | Payments | `/payments` | **missing-in-mock** |
| — | — | Scrap Billing | `/scrap` | **missing-in-mock** |
| — | — | Rejection Advice | `/rejection` | **missing-in-mock** |
| — | — | Attendance & Payroll | `/attendance` | **missing-in-mock** |
| — | — | Excel Import | `/import` | **missing-in-mock** |
| — | — | Rate Masters | `/rates` | **missing-in-mock** |
| — | — | Users & Roles | `/users` | **missing-in-mock** |

## 2. In the mock but NOT in the code → consider adding

1. **Settings page (`/settings`) — biggest gap.** Mock has 5 tabs: **Company · Invoicing · Users ·
   Roles · Backup.**
   - **Company tab** fields: Legal Name · Trade Name · GSTIN · PAN · CIN · MSME/UDYAM · Address ·
     City · State · Phone · Email. → In code these map to the **Unit master** (name/gstin/
     stateCode/address/bank); **CIN, PAN, MSME/UDYAM, Trade Name, Phone, Email are NOT in the Unit
     schema** and would need adding.
   - **Invoicing tab** → maps to Unit's `invoiceFormat` + `seqPad`; could surface terms, prefix,
     logo, T&C.
   - **Users / Roles tabs** → already exist in code as `/users` (could be linked from Settings).
   - **Backup tab** → export/import of the whole localStorage store (per the audit follow-ups, a
     backup UI was deferred).

2. **Standalone Vendor page with stat cards** (Active / On Hold / GST Verified / New 30d) and a
   **Status = Active/Hold** concept. Code has vendors as a Masters tab with **no on-hold status**
   and no summary cards.

3. **Standalone Raw Material Master page** with a **Type filter** (Raw / Semi-Finished / Finished).
   Code's Part master has no `type` field — it has `category` instead.

4. **Inventory page extras:** mock shows **Heat #, Scrap, Utilisation %** columns and KPI cards
   (Heats Tracked, Scrap Generated %, Low Stock Alerts). Code's Stock page is leaner
   (Opening/Received/Consumed/Available/Reconcile).

5. **Dashboard richness:** mock has **8 KPIs + 3 charts** (Revenue vs Expenses, Dispatch by
   Customer, Stock Movement); code has **4 KPIs + activity feed + lowest-stock list, no charts.**

## 3. In the code but NOT in the mock → KEEP (real features)

These are genuine domain features the mock simply doesn't depict. Do not remove:
- **Payments** (`/payments`) — multi-bill receipt allocation + reversal.
- **Scrap Billing** (`/scrap`) — scrap sale with GST **+ TCS**.
- **Rejection Advice** (`/rejection`) — rejected-material delivery challans.
- **Attendance & Payroll** (`/attendance`) — production-piece + shift earnings.
- **Excel Import** (`/import`) — MIO workbook → mapped → validated → one undoable import.
- **Rate Masters** (`/rates`) — versioned RM & production rates.
- **Users & Roles / RBAC** (`/users`) — 15-module × 6-action permission matrix + per-user overrides.
- **Multi-unit** scoping (UnitSwitcher) and the **reconcile** stock-integrity model.
- **Light/dark theme** + **Undo/Redo** command bus.

## 4. Overlapping-page deltas worth aligning

| Page | Mock has | Code has | Suggested alignment |
|------|----------|----------|--------------------|
| Inward | flat list with **Value** (qty×rate) column, PO/Bin inline | parent/child register, value derived | Add a **Value** column + PO/Bin to the parent row; keep the expandable children. |
| Outward | flat list: Invoice#, Customer, OK Qty, **Faulty**, GST, Total | dispatch lines under a challan (billed/rejection) | Mock's "Faulty" = code's mcRej+mf; surface a combined **Faulty** column. |
| Billing | flat issued-invoice list, **Preview** action, GSTR-1 export | draft→finalize lifecycle, PDF, GSTR export | Add a clear **status column** (Draft/Issued) + a one-click **Preview** on every row. |
| Expenses | **Mode** + Pay Date columns, expense-trend & velocity charts | instalments, status, no charts | Add **Monthly Expense Trend** + **Payment Velocity** charts; show Mode/Pay Date in the row. |
| Reports | 8 named statutory reports incl. **Heat-wise Traceability**, **GSTR-1**, **Vendor Outstanding Statement** | 7 reports | Add **Heat-wise Traceability** + **Vendor Outstanding Statement**; label billing report as **GST Sales Register (GSTR-1)**. |
| Stock/Inventory | Heat#, Scrap, Utilisation% + KPI cards | Opening/Received/Consumed/Available/Reconcile | Add **Scrap** and **Utilisation%** columns + 4 KPI cards above the table. |

## 5. Update plan (prioritized)

### P1 — high value, client-visible
- [ ] **Add `/settings` page** with tabs **Company · Invoicing · Users · Roles · Backup**.
  - Company tab edits the active Unit; **extend the Unit schema** with `tradeName`, `pan`, `cin`,
    `msmeUdyam`, `phone`, `email`.
  - Users/Roles tabs link to (or embed) the existing `/users` matrix.
  - Backup tab = JSON export/import of the persisted store (ship the deferred backup UI here).
- [ ] **Vendor status** (`active` / `hold`) on the Vendor master + a **Status** column + 4 summary
  stat cards (Active / On Hold / GST Verified / New 30d) on the Masters→Vendors tab (or a
  promoted `/vendors` page).
- [ ] **Dashboard charts**: add **Revenue vs Expenses**, **Dispatch by Customer**, **Stock
  Movement** (Recharts is already a dependency).

### P2 — parity polish
- [ ] **Inventory/Stock parity**: add **Scrap** + **Utilisation %** columns and the 4 KPI cards
  (Total Available / Heats Tracked / Scrap Generated / Low Stock Alerts); add a **Heat #** grouping.
- [ ] **Reports parity**: add **Heat-wise Traceability** and **Vendor Outstanding Statement**
  reports; rename the billing register to **GST Sales Register (GSTR-1)** in the UI.
- [ ] **Expenses charts**: Monthly Expense Trend + Payment Velocity.
- [ ] **Inward Value column** + show PO/Bin on the parent row.
- [ ] **Part `type`** (Raw / Semi-Finished / Finished) field + a Type filter, to match the
  "Raw Material Master" framing (in addition to existing `category`).

### P3 — naming & nav cosmetics (low risk)
- [ ] Align nav labels to the mock where sensible: "Stock" → **Inventory Stock**, "Inward /
  Outward" → keep but ensure **Material Inward**/**Material Outward** read clearly.
- [ ] Move Dashboard to `/dashboard` (or keep `/` and just label it) to match the mock route.
- [ ] Surface **ERP version + GSTIN** in the footer (mock shows "ERP v4.2 · GSTIN …").

## 6. Decisions you may want to make first
- **Settings vs Masters:** do you want a true Settings page, or keep company config inside the
  Unit master and just *link* to it? (The mock implies a dedicated Settings area.)
- **Vendors/Materials as standalone pages vs Masters tabs:** the mock promotes them to top-level
  nav; the code keeps them as tabs. Promoting them is a small nav change but affects IA.
- **Scope of "Inventory Stock":** match the mock's heat/scrap/utilisation richness, or keep the
  current reconcile-first lean table?
