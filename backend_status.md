# Backend Build Status — HEW ERP

Live tracker for the backend API program. The frontend (`frontend_2.0`) is a complete,
working, frontend-only ERP (Zustand store + localStorage). This backend exposes the SAME
domain as real REST APIs and the frontend is then wired to it module-by-module.

_Last updated: 2026-06-11_

## Architecture

| Concern | Choice | Why |
|---|---|---|
| Runtime | Node + Express + TypeScript (`tsx` dev, `tsc` build) | Reuse the frontend's TS domain types & business logic verbatim |
| Persistence | JSON-file document behind a `Repository` interface (atomic temp-rename writes) | Zero native deps, reliable on Windows, swappable to Postgres/Prisma later without touching routes |
| State shape | Mirrors the frontend `RootState` (normalized `byId/allIds` per collection) | Ported selectors/commands compute invoices, stock, reconcile **identically** to the UI |
| Money | Integer `Paise` (ported `money.ts`) | Decimal-safe, matches the UI exactly |
| Auth | JWT access token + `bcryptjs` password hashing | Pure-JS, no native build |
| AuthZ | Ported `rbac.ts` (`can(module, action)`) as `requirePermission` middleware + unit-scope guard | Same matrix the UI enforces |
| Validation | Zod per route | Mirrors the frontend form schemas |
| Errors | `ApiError` + central error middleware → `{ error, detail }` JSON | Consistent client handling |

**API base:** `/api`. **Demo logins** (password `demo`): `admin@hew.in`, `manager@hew.in`, `opa@hew.in`, `opb@hew.in`.

## Module API plan (mirrors the command bus)

Each module = a router + service (ports the matching frontend command/selector) + Zod validators + smoke coverage.

| # | Module | Routes (verb path) | Ports from frontend | Status |
|---|---|---|---|---|
| 0 | **Foundation** | repo, state, money, rbac, domain types, error mw, server | normalized.ts, state.ts, money.ts, rbac.ts, domain.ts | ✅ done, typecheck clean |
| 1 | **Auth** | `POST /auth/login`, `GET /auth/me` | session + can() | ✅ done, smoke 6/6 |
| 2 | **Masters** | `GET/POST/PUT/DELETE/PATCH /masters/:entity[/:id]` for units, customers, vendors, parts, stock-openings, machines, operations, employees | masterCommands, defineMaster, registry | ✅ done, smoke 8/8 (incl. RBAC + unit-scope) |
| 3 | **Rates** | `GET /rates/rm`, `GET /rates/rm/current/:partId`, `POST /rates/rm`, `GET/POST /rates/production` (versioned, supersede) | masterCommands rate variants | ✅ smoke ok (current p3 = ₹62) |
| 4 | **Inward** | `GET /inward` (scoped, date filter), `GET /:id`, `POST /inward`, `PUT /:id`, `DELETE /:id` | registerCommands.runSaveInward/runDeleteInward | ✅ smoke ok (edit + delete guards) |
| 5 | **Dispatch / Outward** | `GET /dispatch`, `POST /dispatch` (single/batch; edit by id; over-dispatch guard), `DELETE /:id` | registerCommands.runSaveDispatchBatch/runDeleteDispatch | ✅ smoke ok (stock cascade + restore) |
| 6 | **Invoices / Billing** | `GET /invoices`, `GET /:id/doc`, `POST /invoices/finalize`, `POST /:id/void` | billingCommands, invoiceCompute | ✅ smoke ok (254 totals exact) |
| 7 | **Payments** | `GET /payments`, `GET /outstanding`, `POST /payments`, `POST /:id/reverse` | billingCommands.runRecordPayment / reverse | ✅ smoke ok (outstanding cascade) |
| 8 | **Stock** | `GET /stock` (date window), `GET /:unitId/:partId` | selectors/stock, register | ✅ smoke ok (p6=12000) |
| 9 | **Scrap** | `GET /scrap`, `POST /scrap`, `PUT/DELETE /:id` | scrapCommands, scrapMath | ✅ smoke ok |
| 10 | **Expenses** | `GET /expenses`, `POST /expenses`, `POST /:id/pay`, `DELETE /:id` | expenseCommands | ✅ smoke ok (exp2 balance) |
| 11 | **Rejection** | `GET /rejection`, `POST /rejection`, `DELETE /:id` | financeCommands rejection | ✅ smoke ok (weight calc) |
| 12 | **Attendance / Payroll** | `GET/POST/DELETE /attendance/production`, `/shift`, `GET /payroll` | attendanceCommands, selectors/attendance | ✅ smoke ok (earned/wage exact) |
| 13 | **Reports** | `GET /reports/dashboard/kpis`, `/receivables`, `/production-summary`, `/stock-summary` | selectors/reports, kpi, finance | ✅ smoke ok (KPIs match seed) |
| 14 | **Users / Roles** | `GET/POST/PUT/PATCH /users`, `PUT /:id/override`; `GET/POST/PUT/DELETE/POST-reset /roles` | userCommands, roleCommands | ✅ smoke ok (hash hidden, RBAC) |
| 15 | **Import** | `POST /import/preview`, `POST /import/apply` (parsed rows JSON) | importCommands, mioImport | ✅ built, typecheck clean |
| 16 | **System** | `POST /system/reset-demo`, `GET/POST /system/backup` (admin) | resetDemoData, backup | ✅ smoke ok (reset restores seed) |

**Domain math ported** (`backend/src/domain/`): stock, register, reconcile, billing, invoiceCompute, finance, attendance, kpi, reports, format (+ `lib/fy`, `lib/scrapMath`). Whole backend `tsc --noEmit` → exit 0.

**Verification:** `node scripts/smoke-all.mjs` → **32/32 pass** (concrete seed numbers: invoice 254 assessable 15,157,950 / IGST 1,818,954 / grand 16,976,900; payroll e1 ₹2,950 / e2 ₹810; dispatch & payment cascades; RBAC; reset-demo).

## Verification

- **Automated tests** (`npm test` — `node:test` via tsx, **16/16**):
  - `test/domain.test.ts` (8) — pure ported math on a fresh seed: invoice 254 totals + intra-state GST split, stock (live + date-window), outstanding, scrap value/GST/TCS/grand, payroll earnings/wages.
  - `test/api.test.ts` (8) — supertest against the real app: auth + hash-hiding, RBAC (operator forbidden) + unit-scoping, master CRUD round-trip, inward edit + delete guards, dispatch→stock cascade + restore, payment→outstanding cascade. State reset to a fresh seed (temp DB) before each test.
- Per-module smoke: `scripts/smoke.mjs` (14) + `scripts/smoke-all.mjs` (**36/36**) against a running server.
- Run server: `npm run dev` (port 4000). Smoke: `node scripts/smoke-all.mjs`.
- Frontend: 126 unit tests + E2E suites (admin read+write 3/3, operator hydration 5/5, reload-session 5/5).

## Frontend integration

**Done (feature-flagged on `VITE_API_BASE`; unset = pure local mode, default):**
- `src/api/client.ts` — typed fetch wrapper (bearer token, `{data}` unwrap, `ApiError`).
- `src/api/auth.ts` — `apiLogin`/`apiMe`/`apiLogout`.
- `src/api/hydrate.ts` — `hydrateStoreFromApi()` pulls the full book via `GET /system/backup` and shallow-merges it into the Zustand store, so **every page renders real backend data with no per-page rewrite**.
- `src/api/session.ts` — `loginViaApi` (auth → hydrate → open scoped session via existing `login(id)`; demo ids match across both seeds) + `logoutViaApi`.
- Login screen + UserMenu sign-out route through the API when the flag is set; unchanged in local mode.
- **E2E verified** (`scripts/apiModeE2E.mjs`, 5/5): real `POST /auth/login` + `GET /system/backup`, Stock/Billing show backend data. 122 local unit tests still green; `tsc -b` clean.

**Write-through — DONE (verified):** a decoupled post-commit hook on the command bus (`setWriteSyncHook`) mirrors every successful local command to the backend in API mode.
- `src/api/writeThrough.ts` + `src/api/modules.ts` (typed per-module client).
- **Admin** → atomic, coalesced full-state snapshot to `POST /system/backup` — covers every command/module with no per-command mapping and no id/sequence divergence (server ends byte-identical to the tested local state).
- **Operator/Manager** → create-style commands routed to their module endpoints (inward, dispatch, invoices, payments, scrap, expenses, rejection); edits/deletes without a matching endpoint show a "saved locally" notice.
- Installed on API login; no-op in local mode. **E2E verified** (`scripts/writeThroughE2E.mjs`, 3/3): a customer created in the UI persists to the backend (`POST /system/backup` fired; row present on a fresh `GET /masters/customers`). 122 unit tests still green; build clean.

**Parity completed (2026-06-15):** backend `PUT/DELETE` for inward + `DELETE` for dispatch added (edit/delete guards ported — no over-dispatch, can't delete a challan with dispatches/rejections, can't delete a dispatch on an issued bill). Smoke now **36/36**. Operator/manager write-through expanded to route edits/deletes too: the bus hook now passes `cmd.module`, so the shared `deleteEntity` command disambiguates inward vs dispatch vs masters; master saves route to `/masters/:entity` by id-prefix (reading the canonical stored entity). Routing covered by `src/api/writeThrough.test.ts` (4 tests). Frontend suite **126** green.

**Module-GET reads (2026-06-15):** hydration now uses the per-module GET endpoints for non-admin. `hydrateViaModules()` assembles the normalized store from ~20 scoped module GETs (extracting the raw entity from each view-model wrapper). This:
- **fixes the operator gap** — operators/managers previously couldn't hydrate (the `/system/backup` snapshot is admin-only) and saw local seed data; they now see real, unit-scoped backend data;
- makes the live app exercise the read endpoints with backend-enforced scoping.
Admin keeps the one-shot `/system/backup` snapshot (it also carries the `system` slice: sequences/flags). Verified by `scripts/operatorHydrationE2E.mjs` (5/5: operator hydrates via module GETs, not the snapshot; sees u1 parts, not u2's).

**Session robustness (2026-06-15):** the in-memory session is lost on reload, but the bearer token persists — so `restoreApiSession()` (run by an `App` boot gate, behind a brief splash) re-validates it via `GET /auth/me`, re-hydrates per role, and reopens the session, landing the user straight back on their deep-linked page. A global 401 in the client clears the stale token (backend uses 403 for permission denials, 401 only for auth), so an expired token cleanly bounces to `/login`. Verified by `scripts/reloadSessionE2E.mjs` (5/5: reload restores via `/auth/me`, stays on `/inventory`; dead token cleared + bounced).

**Status: integration complete + hardened.** Reads (per-role) + writes (per-role) go through the module APIs / snapshot; session survives reload. Backend smoke 36/36; frontend 126 unit tests; E2E suites — admin read+write 3/3, operator hydration 5/5, reload-session 5/5 — all green.

Run it: backend `cd backend && npm run dev`; frontend `cp .env.example .env.local && npm run dev` (uses `VITE_API_BASE`).

## Production readiness (2026-06-15)

| Gap (from the earlier review) | Status |
|---|---|
| JSON-file persistence | ✅ **Postgres** behind a pluggable `PersistenceDriver` (file kept for offline/test). Per-command **transactional** writes, value-diffed; durability proven by `test:pg` (survives restart). |
| Admin snapshot last-write-wins | ✅ **Optimistic concurrency** — monotonic state version; stale snapshot → 409 → client re-syncs (no silent clobber). |
| Auth/security | ✅ helmet, login rate-limiting, prod CORS lock, **fail-fast prod config guard** (strong `JWT_SECRET` + `DATABASE_URL` + CORS required), **change-password** endpoint. |
| Only happy-path tests | ✅ **28 backend tests** (unit + HTTP integration + sad paths: 400/404/409 guards, RBAC, scoping, concurrency, deactivated-login) + 2 PG durability + 36 smoke; frontend 126 unit + 3 E2E suites. |
| Deploy/ops | ✅ `docker-compose.yml`, top-level `README.md` (dev + prod run, env table). |

**Honest remaining caveats (documented, not blockers at this scale):**
- Single API instance assumed — the in-memory cache + version are per-process; multi-instance needs sticky routing or a shared cache/invalidation layer.
- Bearer token in `localStorage` (short-lived + 401-cleared); httpOnly-cookie + refresh-token migration is the next security step.
- Reads are hydrate-on-login (no live push/websockets); a second user sees changes on next reload.
- No structured logging / metrics / CI yet.

## Completeness pass (2026-06-15)

| Item | Status |
|---|---|
| **Server-side pagination + search** | ✅ all list endpoints accept `?page=&pageSize=&search=` → `{ data, total, page, pageSize, totalPages }` (no params ⇒ all rows, hydrate-safe). Frontend: `usePagedRows` + `<TablePager>` on every register + masters; search on all master types. |
| **Write-through gaps** | ✅ attendance (production/shift save+delete), rate masters, and expense/rejection **edits** now route to module endpoints (were "saved locally"). New `PUT /expenses/:id`, `PUT /rejection/:id`. |
| **Id divergence** | ✅ create endpoints honour a client-supplied id (`resolveId`); the optimistic UI's id matches the server, so non-admin create-then-edit no longer 404s. Collisions still mint a fresh id. |

**Tests after this pass:** backend **34** (+ pagination/search/edits/client-id/sad-paths) + **2** PG durability; frontend **127** unit (+ routing) + 3 E2E suites. All green against the live Postgres backend.

**Intentionally local (not a gap):** the frontend computes dashboard/stock/payroll/outstanding/invoice-doc from the hydrated data via the same ported selectors (offline-capable, identical numbers), so those *aggregate* GET endpoints exist + are tested but aren't called live. Reads hydrate the whole book on login (client-side paginate/search); the backend `?page=` capability is ready for a future fetch-per-page mode at large scale.

## Production-readiness audit (2026-06-16)

Gaps found and closed:
- **Reliability/ops** — graceful shutdown (SIGTERM/SIGINT drain + PG pool close), process-level `uncaughtException`/`unhandledRejection` logging, structured JSON request/error logging with `X-Request-Id` correlation, `GET /api/ready` (DB ping → 503 when down) vs cheap `/api/health`, global per-IP API rate limit.
- **Data integrity** — a failed durable write now reloads state from the datastore so in-memory never stays ahead of the DB (the PG write is transactional and rolls back).
- **Frontend resilience** — API client has a 20s timeout (AbortController) + clean network/timeout errors; per-route ErrorBoundary already present.
- **Deploy** — backend `Dockerfile` (multi-stage, non-root, HEALTHCHECK on `/ready`) + `docker compose up` runs DB + API together; GitHub Actions CI (typecheck + tests + Postgres durability + build for both apps).

**Still open (documented, product decisions):** httpOnly-cookie + refresh-token auth (today: short-lived bearer in localStorage, 401-cleared); multi-instance (in-memory cache is per-process — needs a shared cache/invalidation or sticky routing); KPI tiles + login hydrate still read the full dataset (server-paged *tables* are done; moving KPIs to summary endpoints removes the last full-load); DB schema migrations (currently `CREATE TABLE IF NOT EXISTS`).

## Changelog
- 2026-06-11 — Program kicked off; architecture chosen; foundation scaffolding begun.
- 2026-06-15 — Production hardening: Postgres persistence (transactional, durable), optimistic concurrency, auth/security hardening, full sad-path + PG test coverage, docker-compose + README.
- 2026-06-11 — Foundation + auth + masters built; smoke 14/14.
- 2026-06-11 — All 15 remaining modules built (workflow), integrated, whole-backend `tsc` clean; full smoke **32/32** (exact seed numbers). Frontend read-integration wired + E2E 5/5.
