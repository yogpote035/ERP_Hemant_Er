# HANDOVER — HEW ERP frontend

> Lets a fresh session continue instantly. Update at the end of every work session.

## Snapshot
- **Project:** Hemant Engineering Works — Job Work Management & Billing ERP. **Frontend-only** (no backend), localStorage-persisted. Domain & architecture: [`../plan.md`](../plan.md). Living status: [`../status.md`](../status.md).
- **App lives in:** [`../frontend/`](../frontend/) (Vite + React 18 + TS strict + Zustand). Planning docs stay at the repo root.
- **Stack decision:** React + Zustand (+ immer/persist) + React Hook Form + Zod + Tailwind + TanStack Table/Virtual + SheetJS + @react-pdf/renderer + date-fns + nanoid + Recharts + sonner. **No** Redux/RTK Query/Axios/Socket.IO/React Query — there is no backend to consume (the CRM-style prompt that mentioned them was explicitly set aside).
- **Reuse source:** generic primitives/utils may be adapted from `c:\Users\Admin\Code\CRM_FOR_Vanrai\frontend` and `c:\Users\Admin\Code\frontend` (e.g. `ErrorBoundary`, `EmptyState`, `ConfirmDialog`, `storageQuota`). They use Tailwind component classes (`.btn`, `.card`, `text-default`, `text-muted`) — those are now defined in `frontend/src/index.css`, so adapted components drop in.

## Current branch / tag
- Branch: `master` · Latest tag: **`frontend-ui-overhaul-v1`** (then `frontend-roles-v1`, `frontend-polish-v1`, `frontend-rbac-v1`, `frontend-reports-v1`, `frontend-drawer-v1`, `frontend-p3-p6-v1`; per-phase: `frontend-import-v1`, `frontend-billing-v1`, `frontend-finance-v1`, `frontend-attendance-v1`; prev `frontend-ui-mock-v1`, `frontend-register-v1`, `frontend-masters-v1`, `frontend-shell-v1`, `frontend-domain-v1`, `frontend-bootstrap-v1`). Local commits; **not pushed** — no remote configured.

## What's completed (P0 foundation — all green)
- Scaffold: Vite, TS strict (`noUncheckedIndexedAccess`), Tailwind, ESLint/Prettier, Vitest. `npm run build` + `typecheck` + `test` all pass.
- `src/styles/tokens.css` — indigo/slate RGB-channel CSS-variable tokens (light + `.dark`); `src/index.css` component classes.
- `src/lib/money.ts` — integer-paise core (toPaise/addP/mulQty/pctOfPaise/roundToRupee/roundOffDelta/splitGst[odd-paisa→CGST]/formatINR[Indian]/toWordsIndian). **17 tests** incl. real float-drift + scrap-TCS chain (₹2,92,630.40).
- `src/lib/{cn,id,fy,date}.ts` — utils (fy = Indian FY label, date = flexible dd.MM.yyyy + Excel-serial parse).
- `src/types/rbac.ts` — single `Module` enum, `Action`, `Role`, presets, `effectivePermissions`, `can()`.
- `src/types/domain.ts` — all entities (normalized; stock per (unit,part); Dispatch has no own unitId; snapshots only).
- `src/store/` — `normalized.ts` (CRUD), `state.ts` (RootState + createEmptyState + persisted subset), `index.ts` (Zustand + persist `hew-erp-v1` + session helpers login/logout/setActiveUnit + currentUser), `scope.ts` (allowedUnitIds / scopedInwards / scopedDispatches choke point), `commandBus.ts` (runCommand + undo + redo + activityLog, immer produceWithPatches), `commands.ts` (CommandName + error/result types), `persistence.ts` (ensureSeeded / resetDemoData / buildBackup / validateBackup / importBackup / downloadBackup). **3 store tests**.

### Completed since (`frontend-domain-v1`)
- `src/selectors/stock.ts` — `dispatchTotalQty`, `selectPartStock` (per unit,part), `selectAvailableForInward`, `selectInwardBalance` (In-house/Partial/Dispatched).
- `src/selectors/reconcile.ts` — corrected invariants **I1** over-dispatch, **I2** oversold, **I3** orphan-dispatch, **I5** physical-count; `selectPartLedger` + `selectReconcile` (RED-badge result).
- `src/lib/seed.ts` — `seedState()`: 7 units (u1 = real HEW GSTIN 27ADGPV9846A1Z6), 13 parts (11 real PART MASTER @12% + 2 demo @18%), Rolex(24)+Yenkay(27 intra)+SKF(29) customers, 3 vendors, **golden challan 8202421273** (28000 → d1 12020 / d2 14000 / d3 242-rej-DC15 / d4 1738, all bill 255 & 268), openings (p6 +2000, p9 +1000), 4 invoices (254/255/268/270) + 1 RTGS payment, 2 scrap bills, machines/ops/employees/attendance, 4 users (admin/manager/op1@u1/op2@u2). Seed reconciles GREEN.
- `main.tsx` calls `ensureSeeded()` on boot; `App.tsx` is a bootstrap dashboard (seeded counts + live reconcile badge + Reset button).
- **+9 tests** in `src/selectors/reconcile.test.ts` (seed shape, stock, reconcile I1/I3/I5). Total **29 tests green**; `tsc -b` + `vite build` green.

### Completed since (`frontend-shell-v1`)
- **Selectors:** `src/selectors/billing.ts` (`paidForInvoice`/`invoicePaymentStatus`[paid>overdue>partial>unpaid]/`outstandingForInvoice`/`selectBillingTotals` — scoped) + `src/selectors/kpi.ts` (`selectDashboardKpis`, scoped via `allowedUnitIds`/`scopedInwards`/`scopedDispatches`). `reconcile.ts` gained **`selectReconcileScoped`** (the leak fix). **+11 tests** (billing 4, kpi 3, Login smoke 1, +3 from reconcile precedence). Total **37 tests green**.
- **UI primitives** (`src/components/ui/`, barrel `index.ts`): `Button` `Card`/`CardHeader` `Badge` `Input`/`Field`(auto-wires id+aria) `Select` `Spinner` `Skeleton`/`TableSkeleton` `EmptyState` `Modal`(portal + focus-trap + aria) `ConfirmDialog` `Tooltip`. Plus `src/components/ErrorBoundary.tsx` (class, compact/full).
- **RBAC gate:** `src/components/Can.tsx` (`<Can module action>`), `src/hooks/useCan.ts` (memoized checker). Both call the same `can()` the command-bus enforces.
- **Theme:** `src/lib/theme.ts` + `src/hooks/useTheme.ts`; pre-paint inline script in `index.html` (no flash); `--danger-fg` token added.
- **App shell** (`src/components/layout/`): `AppLayout` (sidebar+topbar+per-route ErrorBoundary keyed on path), `Sidebar` (sections filtered by `can(view)` + scoped reconcile footer), `Topbar`, `UnitSwitcher` (narrow-only), `UserMenu` (Escape+focus return), `UndoRedo` (command-bus), `ThemeToggle`. Hook `src/hooks/useOnClickOutside.ts`.
- **Routing** (`src/app/`): `nav.ts` (single nav model → routes+sidebar+breadcrumb), `guards.tsx` (`RequireAuth` incl. inactive-user bounce; `RequirePermission`+`NoAccess`), `router.tsx` (`createBrowserRouter`; `REAL_PAGES` registry → add P1+ pages here). Pages: `Login` (mock user picker), `Dashboard` (scoped KPIs + reconcile + activity), `Placeholder` (phase-aware), `NotFound`. `App.tsx` → `RouterProvider`; `main.tsx` calls `initTheme()`.
- **Reviewed:** 4-dimension adversarial review workflow; **11 findings fixed** (BUG_TRACKER #3–13), incl. cross-unit scope leak, overdue-KPI precedence, ₹0-invoice settle, Modal/Field a11y, selector render-churn. `tsc` + `eslint(0)` + `vite build` + **37 tests** all green.

### Completed since (`frontend-masters-v1`)
- **Config-driven masters framework** (`src/masters/`): `types.ts` (FieldSpec/MasterConfig/MasterView/RenderHelpers), `defineMaster.ts` (type-erasure, the only place `as T` lives), `EntityManager.tsx` (generic scoped list + create/edit modal + soft-delete/reactivate, `can()`-gated), `MasterTabs.tsx`, `registry.tsx` (10 specs).
- **Commands** (`src/store/masterCommands.ts`): `makeMasterCommands` → create('create')/update('edit')/remove('delete')/activate('edit'). zod re-validated inside the command; **unit-membership enforced** via `writableUnitIds` (new in `store/scope.ts` — role-based, ignores view-focus). Opening stock has an `extraValidate` (part.unitId === unitId).
- **Form fields** (`src/components/form/AutoField.tsx`): text/textarea/number/money(₹→paise)/date/select(+synthetic "current" option)/checkbox, RHF-wired with `aria-describedby`.
- **Pages**: `Masters.tsx` (8 tabs) + `Rates.tsx` (2 tabs), registered in `router.tsx` → `REAL_PAGES`.
- **+8 tests** (`src/masters/masters.test.tsx`): CRUD, zod-in-command, RBAC, unit-scoping write enforcement, opening part/unit, deactivate-needs-delete, EntityManager render. Total **45 tests green**.
- Reviewed (3-dim workflow) → 8 fixes (BUG_TRACKER #14–21).

### Completed since (`frontend-register-v1`)
- **Commands** (`src/store/registerCommands.ts`): `runSaveInward` / `runSaveDispatch` (create+edit) / `runDeleteInward` / `runDeleteDispatch`. `saveOutwardDispatch` = the one-action-many-effects transaction (dispatch + draft invoice per (unit,billNo) via `relinkInvoice` + rate/GST snapshot + I1 over-dispatch + unit-scope + issued-invoice immutability). 13 tests in `registerCommands.test.ts`.
- **Selectors** (`src/selectors/register.ts`): `selectInwardRows` (expandable grid), `selectDispatchRows` (log), `selectStockRows`, `latestProductionRatePaise`.
- **UI**: `pages/InwardRegister.tsx` (expandable parent→child), `pages/DispatchList.tsx` (log + `ChallanPicker`), `pages/Stock.tsx`; `components/register/DispatchForm.tsx` (bespoke, conditional rate) + `inwardForm.ts` (fields/schema/mappers) + reusable `components/form/RecordFormModal.tsx`. Wired `inward`/`dispatch`/`stock` in `REAL_PAGES`.
- **Shared extracts**: `masters/options.ts` (unit/part/vendor/customer/machine/operation option builders), `lib/commandToast.ts` (`toastCommandError` / `toastCommandSuccess`).
- Reviewed (3-dim) → 7 fixes (BUG_TRACKER #22–28). **58 tests green.**

### Completed since (`frontend-ui-mock-v1`) — match the job-work mock UI (light + dark)
- **Design system** re-tuned to the client mock (`~/Downloads/job_work_mock_ui.html`): `tokens.css` now carries the slate/blue palette + a `--accent` (violet part-tags) + `--faint` + a **dark-rail sidebar token set that stays dark in BOTH themes**; full `.dark` variants. `tailwind.config.js` exposes `accent`/`faint`/`sidebar.*`. `.cell-input` added to `index.css`.
- **Primitives** (`components/ui/`): `Kpi`/`KpiGrid` (corner-accent metric cards), `Tabs` (segmented filter — `role=group` + `aria-pressed`, NOT ARIA tabs), `Chip` (filter/warn), `Badge` gained an `accent` tone. Barrel updated.
- **Shell:** `Sidebar` is now a dark rail (HE gradient logo, section labels, blue active, avatar footer, bright `-400` reconcile pill); `Topbar` = breadcrumb (`breadcrumbForPath`) + a **functional** register search (`/inward?q=…`) + unit/theme/user; `AppLayout` widened to `max-w-[1400px]`.
- **Pages:** `InwardRegister` rebuilt to the mock (page head, 4 KPIs, tabs + part filter + rejection warn-chip + clearable search chip, expandable register with mock columns; child dispatch sub-table computes sub/IGST/grand from the snapshot; keyboard-accessible disclosure `<button>`). New **`OutwardEntry`** page (the mock's multi-line entry: reference card + live line grid + totals footer + over-stock warning) replaces the old `DispatchList` at `/dispatch` (nav relabelled "Outward entry"). `Dashboard` re-skinned (4 accent KPIs + activity / lowest-stock).
- **Command:** `runSaveDispatchBatch` — ONE atomic, undoable command saving all outward lines; enforces **cumulative** I1 over-dispatch; same-bill lines collapse onto one draft invoice (reuses `applyDispatch`). +3 tests → **61 tests green.**
- **Playwright visual harness:** `frontend/scripts/shoot.mjs` (dev-only `playwright` devDep) drives the dev server and shoots light+dark of dashboard/register/outward to `scripts/shots/` (gitignored). Run: `node scripts/shoot.mjs` (server on :5173). Note: the session is in-memory (a full reload logs out) — the script logs in once then navigates via SPA links.
- Reviewed (4-dim adversarial + skeptic verify) → 10 fixes (BUG_TRACKER #29–38), 6 findings rejected with reasons. `tsc` + `eslint(0)` + **61 tests** + `vite build` all green.

### Completed since (`frontend-p3-p6-v1`) — the P3–P6 build (one continuous effort)
- **P3 Excel import** — `lib/mioImport.ts` (pure parse/group: a Received-QTY row opens an inward, a blank-received row with a bill/qty appends a dispatch to the prev challan; Excel-serial + dotted dates; money→paise) + `store/importCommands.ts` (`runImportMio` = ONE atomic, undoable txn: inwards + dispatches + a draft invoice per (unit,billNo); `previewImportIssues` for unknown part / dup challan / cumulative over-dispatch) + `pages/ImportWizard.tsx` (drop→sheet+unit→column-map→preview/validate→import; **xlsx dynamic-imported** → 429 kB lazy chunk). `/import` wired + nav `ready`.
- **P4 Billing** — `selectors/invoiceCompute.ts` (challan-wise lines, `deriveTaxKind`, `computeInvoice` totals via `splitGst`+round-off, packing, list rows, `selectInvoicePdfModel`) + `store/billingCommands.ts` (`runFinalizeInvoice`/`runVoidInvoice`/`runRecordPayment`) + `lib/invoicePdf.tsx` (**@react-pdf dynamic-imported** → 1.3 MB lazy chunk) + `pages/Billing.tsx` (status tabs, builder modal, void, bulk PDF) + `pages/Payments.tsx` (allocate one receipt across bills). The Bill No IS the invoice number → no sequence minted.
- **P5 Scrap/Expenses/Rejection** — `lib/scrapMath.ts` (`computeScrap`, AC **29,263,040** locked) + `selectors/finance.ts` (scrap totals, expense balance/status, vendor-outstanding, rejection rows) + `store/scrapCommands.ts` + `store/expenseCommands.ts` + pages `Scrap`/`Expenses`/`RejectionAdvice`.
- **P6 Attendance** — `selectors/attendance.ts` (makeQty/earned, hours/wage, `latestProductionRate` wildcard+specificity, per-employee earnings) + `store/attendanceCommands.ts` (rate auto-fetch + snapshot, OK≤made guard) + `pages/Attendance.tsx` (Production/Shift/Earnings, live previews, OT).
- **+20 tests → 81 total.** Reviewed (4-dim adversarial + skeptic) → **8 fixes** (BUG_TRACKER #39–46), 1 skipped + lows deferred with reasons. `tsc` + `eslint(0)` + `vite build` green. Screenshot harness extended to the new pages.

### Completed since (`frontend-drawer-v1`, `frontend-reports-v1`)
- **Reused the CRM_Core `Drawer`** (`tag frontend-drawer-v1`): ported it into `components/ui/Drawer.tsx` adapted to HEW semantic tokens, with the `Modal` prop API (`open/onClose/title/description/footer/size/closeOnBackdrop`) + maximize toggle + focus-trap/Esc/backdrop/scroll-lock/`role=dialog`. Converted the 8 record/form dialogs (DispatchForm, RecordFormModal, EntityManager, Billing builder, Payments, Expenses×2, RejectionAdvice) `Modal → Drawer`; `ConfirmDialog` stays a centered `Modal`.
- **P7 Reports** (`tag frontend-reports-v1`): `selectors/reports.ts` (config-driven `REPORTS` registry of pure builders over the existing scoped selectors — inward/outward register, billing summary, **customer-wise revenue**, stock, scrap, expense outstanding, attendance earnings; date-range aware) + `lib/exportXlsx.ts` (lazy SheetJS → `.xlsx`, reuses the existing `xlsx` chunk) + `pages/Reports.tsx` (report picker + From/To + live table + Export Excel). `/reports` wired. **+4 tests → 85 total.** `tsc`/`eslint(0)`/`vite build` green.

### Completed since (`frontend-rbac-v1`) — P8 RBAC screens
- `store/userCommands.ts` — `runCreateUser` / `runUpdateUser` / `runToggleUserActive` / `runSetUserOverride` (all `module:'users'`, so admin-only) + `diffOverride` (desired grid → minimal add/remove deltas vs the role preset). Lockout guards: can't demote/deactivate the last active admin; can't deactivate yourself; admins can't carry overrides; unique email; non-admin needs ≥1 unit.
- `pages/Users.tsx` — user list (role/units/status), create/edit **Drawer** (name/email/role/unit-checkboxes), and the **permission-matrix Drawer** (15 modules × 6 actions; cells differing from the role preset highlight + save as overrides; reset-to-preset). `/users` wired (admin-only via the existing route guard).
- **+6 command tests → 91 total.** `tsc`/`eslint(0)`/`vite build` green.

### Completed since (`frontend-polish-v1`) — P9 Polish & QA
- **Route-based code-splitting** (`app/router.tsx` + `AppLayout`): every authenticated screen is `React.lazy`-loaded behind a `<Suspense>` boundary (a labelled `Skeleton` fallback); Login/Placeholder/NotFound stay eager. Initial JS bundle **~650 kB → 341 kB (109 kB gzip)**; pages are 5–22 kB chunks. The remaining >500 kB build warning now fires ONLY on the deliberately on-demand `xlsx` (429 kB) and `invoicePdf`/@react-pdf (1.3 MB) chunks — neither is in the first paint. Smoke-tested: all lazy routes resolve through Suspense in 85–172 ms and render fully.
- **localStorage quota-guard** (`lib/quotaStorage.ts` → wraps the Zustand persist storage): a quota-exceeded / privacy-mode write is swallowed (app keeps running on in-memory state) and warns the user once via a toast, instead of silently losing writes.
- **Reconcile gate** (`selectors/reconcileGate.test.ts`): asserts the seed reconciles GREEN (zero unbalanced ledgers, no orphan dispatches) so a future seed/invariant regression fails loudly.
- **a11y:** the AA sweep landed in the UI-mock review; the new Suspense fallback is `aria-busy` + labelled.
- **Accepted residual — selector memoization:** the `useShallow`-over-fresh-arrays churn is left as-is. The data sets are small (hundreds of rows), so the re-render cost is negligible; a full per-slice memo layer was judged not worth the staleness risk in the polish phase. Revisit only if a real perf issue appears.
- **+1 test → 92 total.** `tsc`/`eslint(0)`/`vite build` green.

### Completed since (`frontend-ui-overhaul-v1`) — UI overhaul (4 milestones)
- **M1 foundation** (`19b6561`): lightened dark-mode `--muted-fg`/`--faint` + sidebar section/meta tokens for AA; gave `EntityManager` its missing table-header bar; **sidebar accordion** (collapsible, persisted, active section pinned open); new **`SearchableDropdown`** UI primitive; **UndoRedo** got `Ctrl/⌘+Z` / `+Shift+Z` shortcuts + tooltips naming the exact action.
- **M3 mock data** (`c61c6d3`): seeded the three previously-empty tables — 5 expenses (paid/partial/overdue + vendor-wise outstanding), 5 RM rates (incl. a superseded→current pair) + 4 production rates, 3 rejection advices from real source challans — all **ledger-neutral** (reconcile gate stays green). NOTE: visible only on a fresh store / Settings → Reset demo data.
- **M2 dropdowns** (`248a015`): replaced **every** native `<Select>` (21 across pages + `AutoField` for all master forms + the topbar `UnitSwitcher`) with `SearchableDropdown` (type-to-filter >7 opts, keyboard nav, `aria-describedby`); numeric values stringified/parsed, enum casts preserved.
- **M4 density + responsive**: global compact density via `html { font-size: 15px }` (rem grid −6%; px breakpoints unaffected) + content max-width 1400→1600px; verified responsive at mobile (off-canvas sidebar drawer, collapsed topbar). `tsc`/`100 tests`/`vite build` green throughout.

### Completed since (`frontend-roles-v1`) — Roles & Permissions module
- **Roles are now editable store data** (`masters.roles: Normalized<RoleDef>`) instead of fixed `ROLE_PRESETS`. `types/rbac.ts` gained `RoleDef`, `seedRoleDefs()`, `clonePermissions()`, and a settable **resolver** (`setRoleResolver`/`basePermissions`) so `effectivePermissions`/`can()` resolve the live matrix for built-in AND custom roles — **no change to `can()`'s signature** across the ~39 call sites; presets remain the seed + fallback. `User.role` widened to `RoleId`.
- `store/roleCommands.ts` — `createRole` (optional clone), `updateRolePermissions`, `renameRole`, `deleteRole`, `resetRole` (all `module:'users'`). Guards: the **admin role matrix is locked** (and `can()` hardcodes admin = full access, so admins can't be locked out and auto-gain future modules); built-ins can't be deleted/renamed; a custom role can't be deleted while users hold it.
- `pages/Users.tsx` is now a tabbed **Users | Roles** page; the Roles tab is the role list + matrix editor + create/clone/rename/delete/reset. The user form's role picker lists all roles (built-in + custom).
- Persistence: `store/index.ts merge()` + `persistence.ts importBackup()` backfill `masters.roles` for data that predates the slice; the resolver degrades to presets if the slice is ever missing.
- Adversarially reviewed (3-dim) → **fixed the must-fix**: role-matrix edits now re-render the gates (`useCan`/`<Can>`/`RequirePermission`/Sidebar previously kept a stale view because only `masters.roles` changed). **+8 tests → 100 total** (incl. a React-render regression test). `tsc`/`vite build` green.

## What's next (the feature build P0–P9 is complete; these need client input / real data)
1. **Open business Qs (plan §9)** still gate a hard P4 lock for edge cases (FY boundary, sequence scope/supplier issuers, scrap TCS rule, rework-after-rejection, multi-bill payment span, email dispatch) — P3–P6 shipped on the logged assumptions.
2. **Reconcile-to-176,921:** drop the real `ROLEX RING LIMITED MIO 2025-26.xlsx` into `/import` (the importer is built) to validate against the real closing figure.

## How to run
```
cd frontend
npm install      # already done (491 pkgs)
npm run dev      # vite dev server
npm run test     # vitest (58 tests)
npm run build    # tsc -b && vite build  (verified green)
npm run typecheck
npm run lint     # eslint, --max-warnings 0
```

## Open business questions (block P3/P4 lock; P0–P2 proceed on assumptions)
See `plan.md` §9 — 6 remaining: FY-boundary date, sequence scope/supplier-issuer, scrap TCS rule, rework-after-rejection + rejection weight basis, multi-bill/cross-unit payment, email-dispatch fallback.
