# Mock-as-SSOT — Frontend Removal Candidates

> **Premise of this doc:** treat the deployed Lovable mock
> ([lovable-mock-ui-spec.md](./lovable-mock-ui-spec.md)) as the **single source of truth**.
> Anything in the current frontend that has **no home in the mock** is listed here as an
> "extra" / removal candidate, with the **impact** of removing it.
> Code side is the authoritative form doc ([current-frontend-forms.md](./current-frontend-forms.md))
> + the live route model (`frontend/src/app/nav.ts`).
>
> ⚠️ **Read this first.** [mock-vs-code-gap-analysis.md §3](./mock-vs-code-gap-analysis.md) lists these
> same "extras" under **KEEP (real features)**, and project memory records that scrap, rejection,
> stock and payroll rules are **proven by the real client xlsx/SRS data**. Most candidates below are
> **not dead code** — they are real domain features the mock simply never drew. Decision (2026-06-04):
> **list only — no code removed.**

---

## Route map: mock (11) vs code (15)

| Code route | Maps to a mock page? | Verdict |
|---|---|---|
| `/` Dashboard | ✅ Dashboard | keep |
| `/inward` Inward/Outward | ✅ Material Inward | keep |
| `/dispatch` Outward entry | ✅ Material Outward | keep |
| `/stock` Stock | ✅ Inventory Stock | keep |
| `/billing` Billing | ✅ Billing & GST | keep |
| `/expenses` Expenses | ✅ Expense & Supplier Payments | keep |
| `/reports` Reports | ✅ Reports & Analytics | keep |
| `/masters` Masters | ⚠️ partial (mock = `/materials` + `/vendors` only) | split / trim |
| `/payments` Payments | ⚠️ folded into mock's "Expense **& Supplier Payments**" | **relocate, not delete** |
| `/users` Users & Roles | ⚠️ exists only as Settings → Users/Roles tabs | **relocate into Settings** |
| `/import` Excel Import | ❌ none | **remove candidate** |
| `/scrap` Scrap Billing | ❌ none | **remove candidate** |
| `/rejection` Rejection Advice | ❌ none | **remove candidate** |
| `/attendance` Attendance & Payroll | ❌ none (no Workforce section in mock) | **remove candidate** |
| `/rates` Rate Masters | ❌ none | **remove candidate** |

*(The mock also has `/settings` and a real `/` Login we'd need to **add** — that inverse list lives in
[mock-vs-code-gap-analysis.md](./mock-vs-code-gap-analysis.md), not here.)*

---

## A. Whole pages with no home in the mock → delete candidates

| # | Page | Impact of removing it |
|---|---|---|
| 1 | **`/rates` Rate Masters** | **High blast radius.** Rates feed: Dispatch line `rateSnapshotPaise` prefill, Billing line rates, and Attendance "Earned = qty × production rate". Delete this and auto-pricing across dispatch/billing/payroll goes manual or breaks. |
| 2 | **`/attendance` Attendance & Payroll** | Self-contained UI, but consumes **Employee, Machine, Operation** masters + production rates. Removing it orphans those masters (see §B). Loses production-piece + shift earnings entirely. |
| 3 | **`/scrap` Scrap Billing** | Fairly standalone (GST **+ TCS** math in `lib/scrapMath.ts`). Memory: scrap rules are **proven by real client data** — removing drops a real billing path. |
| 4 | **`/rejection` Rejection Advice** | Standalone-ish; uses inward challans + part weights. Also **data-backed** per memory. Removing drops rejected-material delivery challans. |
| 5 | **`/import` Excel Import** | Standalone (`lib/mioImport.ts`). Manual Inward still works without it; you only lose the bulk MIO-workbook path. **Lowest-risk removal.** |

## B. Pages that map but carry "extra" the mock doesn't show

| Area | Extra vs mock | Impact of trimming to mock |
|---|---|---|
| **`/masters`** | Mock shows only **Materials** + **Vendors**. Code has 8 tabs: Unit, Part, Vendor, **Customer, Machine, Operation, Employee, Opening Stock**. | • **Customer** — keep; Billing needs a bill-to with GSTIN/state.<br>• **Unit** — keep; it *is* the company profile (becomes mock's Settings→Company).<br>• **Opening Stock** — keep; Stock is "opening + received − consumed", breaks without it.<br>• **Machine / Operation / Employee** — only serve Attendance + Rates. Safe to drop **only if** §A items 1–2 also go. |
| **`/payments`** | Mock has no standalone Payments page. | Don't hard-delete — the mock page is literally "Expense **& Supplier Payments**". Multi-bill receipt allocation + reversal feeds Billing's paid/outstanding and the Dashboard "Outstanding" KPI. Removing the *engine* breaks invoice settlement; relocate the UI, don't delete the logic. |
| **`/billing`** | Code adds a **draft → finalize → sent** lifecycle; mock shows a flat list of already-**Issued** invoices with a Preview action. | Collapsing to a flat list removes the draft safety / immutability-at-finalize behaviour (hardened in commit `8c72561`). |
| **`/inward`** | Code is a **parent/child** expandable register; mock is a **flat** list with a Value column. | Flattening loses the challan→dispatch traceability the data model is built on. |
| **`/users`** | Standalone Admin page with full **15-module × 6-action RBAC** matrix + per-user overrides. | Mock only implies Users/Roles *tabs* under Settings. Keep the engine, relocate the UI. |

## C. Cross-cutting / global extras (app shell, not pages)

| Feature | In mock? | Impact of removing |
|---|---|---|
| **Multi-unit UnitSwitcher** (a unit or "All units") | ❌ Mock is single-plant ("Plant Admin", one GSTIN in footer) | **Largest refactor of all.** `unitId` is required on Part, Machine, Employee, Inward, Expense, Attendance, Opening Stock, etc. Single-unit means defaulting/removing `unitId` everywhere — a data-model change, not a UI delete. |
| **Undo/Redo command bus** | ❌ | The transactional command bus *is* the store's spine (one action → many effects; used by Import/Payments/reversals). You can hide the **toolbar buttons**, but not remove the pattern without rewriting the store. |
| **RBAC enforcement** (`RequirePermission` guards) | ❌ (login exists, granular perms don't) | If `/users` goes, the per-route guards must come out too, or every route 403s. |
| **Light/dark ThemeToggle** | ✅ mock ships light **and** dark | Parity, not an extra — **keep**. |

---

## Bottom line / dependency order

If a "shrink to the mock" pass is ever executed, the **safe-to-hard-delete** set is small and ordered:

1. **`/import`** — cleanest removal, nothing depends on it.
2. **`/scrap`, `/rejection`** — standalone UIs (but data-backed — confirm intent first).
3. **`/attendance` + `/rates` together**, then drop **Machine / Operation / Employee** masters
   (they only serve those two).

Everything else — **Payments, Users/RBAC, multi-unit, Undo/Redo, Billing lifecycle, Inward
parent/child** — is **architecturally load-bearing or data-backed**; "removing" them is a rebuild,
not a delete, and contradicts the project's own SRS evidence.
