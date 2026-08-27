export const meta = {
  name: 'hew-backend-modules',
  description: 'Port shared domain math, then build all remaining HEW ERP backend module routers and integrate them',
  phases: [
    { title: 'Shared domain', detail: 'Port selectors/business-math from frontend into backend/src/domain' },
    { title: 'Module routers', detail: 'One agent per module: rates, inward, dispatch, invoices, payments, stock, scrap, expenses, rejection, attendance, reports, users, roles, import, system' },
    { title: 'Integration', detail: 'Wire app.ts, typecheck whole backend, fix cross-module errors' },
  ],
}

const BACKEND = 'c:/Users/Admin/Code/ERP_Hemant_Er/backend'
const FRONTEND = 'c:/Users/Admin/Code/ERP_Hemant_Er/frontend_2.0'

const CONVENTIONS = `
You are building ONE module of an existing Express + TypeScript (ESM) backend at ${BACKEND}.
The foundation already exists and MUST be reused — do NOT recreate it, do NOT edit shared files
other than your own target file(s). Relative imports MUST end in '.js' (ESM/NodeNext style).

Available foundation APIs (import and use these — do not reinvent):
- Repository:  import { getDb, mutate, values, getById } from '../../db/repository.js'
    getDb(): RootState (read-only; never mutate the returned object directly)
    mutate(async fn(s: RootState) => T): Promise<T>   // apply a write then persist; do ALL writes inside mutate
- Normalized:  import { putEntity, removeEntity, patchEntity, values, getById } from '../../db/normalized.js'
- HTTP:        import { asyncHandler, ApiError, badRequest, notFound, conflict, forbidden } from '../../lib/http.js'
- Auth mw:     import { authenticate, requirePermission, assertUnit, canAccessUnit } from '../../auth/middleware.js'
                 router.use(authenticate)  then per-route requirePermission(module, action)
                 req.auth = { user, allowedUnitIds }  (allowedUnitIds: string[] | null ; null = all units)
- IDs/time:    import { genId, nowISO, todayISO } from '../../lib/id.js'
- Money:       import { toPaise, fromPaise, addP, subP, mulQty, pctOfPaise, splitGst, roundToRupee, roundOffDelta, type Paise } from '../../lib/money.js'
- Types:       import type { ... } from '../../types/domain.js'   (and ../../types/rbac.js for Module/Action/RoleDef)
- Shared math: import { ... } from '../../domain/<file>.js'   (these are ported in phase 1: stock, register, invoiceCompute, billing, reconcile, finance, reports, kpi, attendance)
- State type:  import type { RootState } from '../../db/state.js'
- Validation:  use zod ('zod' is installed).

Conventions:
- Response shapes: list => res.json({ data: rows }); single => res.json({ data: row }); create => res.status(201).json({ data: row }).
  For command-style writes that cascade, optionally include cascade: string[] e.g. res.json({ data, cascade: ['stock -242', 'draft inv-…'] }).
- All money in request/response bodies is INTEGER PAISE (not rupees). Validate with z.number().int().
- Entities get server-managed fields: id = genId(prefix); createdBy = req.auth.user.id; createdAt = nowISO().
- Unit scope: for unit-scoped data, filter list results to req.auth.allowedUnitIds (null = all) and call assertUnit(req, unitId) before writing a row for a unit.
- Throw ApiError helpers (notFound(), badRequest(msg), forbidden(), conflict(msg)) on errors; the central error middleware renders them. Wrap every async handler in asyncHandler.
- Port the BUSINESS LOGIC faithfully from the named frontend source file(s): read them, replicate validation + the cascade/derivation, but adapt imports to the backend foundation above and replace any session/scope (allowedUnitIds(s), scopedX(s)) usage with the route-layer req.auth scope or an explicit parameter.
- Export your router as a named export, e.g. export const inwardRouter = Router(). DO NOT mount it in app.ts (the integration phase does that). DO NOT edit app.ts, repository.ts, state.ts, domain.ts, rbac.ts, money.ts, or any other module's files.
- After writing, run \`npx tsc -p tsconfig.json --noEmit\` from ${BACKEND} and fix errors IN YOUR FILE(S) ONLY (ignore errors that clearly belong to other not-yet-built module files).
Your final message: a 3-6 line summary listing the exact routes you implemented (verb + path) and any caveats/TODOs.
`

// ── Phase 1: shared domain port (sequential — everything depends on it) ──────────
phase('Shared domain')
const sharedPort = await agent(`${CONVENTIONS}

TASK (phase 1 — shared domain math). Port the frontend's read selectors + business math into NEW files under
${BACKEND}/src/domain/ so the module routers can import them. These are the correctness core — port faithfully.

Read these frontend files and create the matching backend files (rewrite '@/...' imports to relative '.js' paths;
replace any '@/store/scope' session scoping with an explicit optional param like \`allowed?: Set<string> | null\`
that defaults to null = no scoping — routes do the scoping):

  ${FRONTEND}/src/lib/fy.ts                  ->  ${BACKEND}/src/lib/fy.ts
  ${FRONTEND}/src/lib/scrapMath.ts           ->  ${BACKEND}/src/lib/scrapMath.ts
  ${FRONTEND}/src/selectors/stock.ts         ->  ${BACKEND}/src/domain/stock.ts
  ${FRONTEND}/src/selectors/register.ts      ->  ${BACKEND}/src/domain/register.ts
  ${FRONTEND}/src/selectors/invoiceCompute.ts->  ${BACKEND}/src/domain/invoiceCompute.ts
  ${FRONTEND}/src/selectors/billing.ts       ->  ${BACKEND}/src/domain/billing.ts
  ${FRONTEND}/src/selectors/reconcile.ts     ->  ${BACKEND}/src/domain/reconcile.ts
  ${FRONTEND}/src/selectors/finance.ts       ->  ${BACKEND}/src/domain/finance.ts
  ${FRONTEND}/src/selectors/kpi.ts           ->  ${BACKEND}/src/domain/kpi.ts
  ${FRONTEND}/src/selectors/reports.ts       ->  ${BACKEND}/src/domain/reports.ts
  ${FRONTEND}/src/selectors/attendance.ts    ->  ${BACKEND}/src/domain/attendance.ts

Notes:
- The backend RootState (../db/state.js) has the SAME shape as the frontend store state, so selector field paths match.
- Any invoicePDF/react/tsx-only helpers: SKIP (do not port JSX). Keep pure data/number functions only.
- If a selector imported '@/selectors/X', import from './X.js' here.
- These files MUST be self-consistent and pass \`npx tsc -p tsconfig.json --noEmit\` together (ignore errors coming
  only from src/modules/* files that don't exist yet). Iterate until your domain files have no type errors.
Return: list the domain files you created and the key exported functions in each.`,
  { label: 'domain-port', phase: 'Shared domain' })

// ── Phase 2: module routers (parallel, after the shared barrier) ─────────────────
phase('Module routers')
const MODULES = [
  { key: 'rates', mod: 'rates', file: 'src/modules/rates/rates.routes.ts', export: 'ratesRouter',
    sources: ['src/store/masterCommands.ts (rate create + supersede-prior-current logic)', 'src/types/domain.ts (RmRate, ProductionRate)'],
    routes: 'GET /rm, GET /rm/current/:partId, POST /rm (create new version: set supersededAt on the prior current row for that part), GET /production, POST /production (same supersede rule keyed by part+machine+operation). Money is paise (ratePaise).' },
  { key: 'inward', mod: 'inward', file: 'src/modules/inward/inward.routes.ts', export: 'inwardRouter',
    sources: ['src/store/registerCommands.ts (runSaveInward)', 'src/selectors/register.ts (selectInwardRows)', 'src/selectors/stock.ts'],
    routes: 'GET / (list inwards; unit-scoped; optional ?from=&to= on challanDate), GET /:id, POST / (create an inward challan with validation). Use the ported domain/register + domain/stock for any derived fields in the list response.' },
  { key: 'dispatch', mod: 'dispatch', file: 'src/modules/dispatch/dispatch.routes.ts', export: 'dispatchRouter',
    sources: ['src/store/registerCommands.ts (runSaveDispatchBatch / saveOutwardDispatch — including over-dispatch validation against available stock and any draft-invoice grouping)', 'src/selectors/stock.ts (selectAvailableForInward)'],
    routes: 'GET / (list dispatches; scoped via parent inward unit), POST / (save one or a BATCH of dispatch lines under an inward; validate okQty+mcRejQty+mfQty does not exceed available; snapshot rate/gst; replicate any draft-invoice creation the frontend command does). Return cascade lines.' },
  { key: 'invoices', mod: 'billing', file: 'src/modules/invoices/invoices.routes.ts', export: 'invoicesRouter',
    sources: ['src/store/billingCommands.ts (runFinalizeInvoice, runVoidInvoice, customerForInvoice, sequence counter)', 'src/selectors/invoiceCompute.ts', 'src/selectors/billing.ts'],
    routes: 'GET / (list invoices with computed totals + outstanding via domain/billing; scoped; optional date filter), GET /:id, GET /:id/doc (invoice doc model from domain/invoiceCompute), POST /finalize { invoiceId, customerId, issuerKind, invoiceDate } (assign seq via system.sequences keyed `${"${issuerId}:${fy}"}`, freeze totals/taxKind/packing/partySnapshot/lineSnapshot, set lifecycle sent), POST /:id/void.' },
  { key: 'payments', mod: 'payments', file: 'src/modules/payments/payments.routes.ts', export: 'paymentsRouter',
    sources: ['src/store/billingCommands.ts (runRecordPayment, runReversePayment, outstandingForInvoice)', 'src/selectors/billing.ts'],
    routes: 'GET / (list payments), GET /outstanding (open invoices with outstanding>0), POST / { mode, ref, date, amountPaise, allocations:[{invoiceId, amountPaise}] } (validate each allocation <= invoice outstanding), POST /:id/reverse.' },
  { key: 'stock', mod: 'stock', file: 'src/modules/stock/stock.routes.ts', export: 'stockRouter',
    sources: ['src/selectors/register.ts (selectStockRows with from/to window)', 'src/selectors/stock.ts (selectPartStock)'],
    routes: 'GET / (stock rows; unit-scoped; optional ?from=&to= movement window), GET /:unitId/:partId (single part stock). Use the ported domain functions; apply req.auth scope.' },
  { key: 'scrap', mod: 'scrap', file: 'src/modules/scrap/scrap.routes.ts', export: 'scrapRouter',
    sources: ['src/store/scrapCommands.ts (saveScrapBill, deleteScrapBill)', 'src/lib/scrapMath.ts'],
    routes: 'GET / (list scrap bills; scoped), POST / (create — weightGrams, ratePerKgPaise, gstPct, tcsPct; derive nothing that should be derived), PUT /:id (edit if draft), DELETE /:id. Include computed totals (assessable/gst/tcs/grand) in the GET response via scrapMath.' },
  { key: 'expenses', mod: 'expenses', file: 'src/modules/expenses/expenses.routes.ts', export: 'expensesRouter',
    sources: ['src/store/expenseCommands.ts (saveExpense, recordExpensePayment, deleteExpense)'],
    routes: 'GET / (list; scoped; include derived paid/balance/status from instalments), POST / (create expense with optional instalments), POST /:id/pay { date, amountPaise, mode, ref } (append an instalment; validate not over total), DELETE /:id.' },
  { key: 'rejection', mod: 'rejection', file: 'src/modules/rejection/rejection.routes.ts', export: 'rejectionRouter',
    sources: ['src/store/financeCommands.ts (runSaveRejectionAdvice, runDeleteRejectionAdvice — note totalWeightGrams = round(qty * weightPerRingMg / 1000))'],
    routes: 'GET / (list; scoped), POST / (create rejection advice; compute totalWeightGrams from (mrQty+frQty) * weightPerRingMg / 1000), DELETE /:id.' },
  { key: 'attendance', mod: 'attendance', file: 'src/modules/attendance/attendance.routes.ts', export: 'attendanceRouter',
    sources: ['src/store/attendanceCommands.ts (saveProductionAttendance, saveShiftAttendance, deletes)', 'src/selectors/attendance.ts (payroll/earned/wage derivations)'],
    routes: 'GET /production, POST /production, DELETE /production/:id, GET /shift, POST /shift, DELETE /shift/:id, GET /payroll?from=&to= (derived per-employee earned/wage summary). Scope by unit. Money snapshots in paise.' },
  { key: 'reports', mod: 'reports', file: 'src/modules/reports/reports.routes.ts', export: 'reportsRouter',
    sources: ['src/selectors/reports.ts', 'src/selectors/kpi.ts', 'src/selectors/finance.ts'],
    routes: 'GET /dashboard/kpis (the dashboard KPI bundle from kpi.ts — requirePermission("dashboard","view")), GET /receivables (finance), GET /production-summary, GET /stock-summary. Each returns { data }. Scope by unit where the selector supports it.' },
  { key: 'users', mod: 'users', file: 'src/modules/users/users.routes.ts', export: 'usersRouter',
    sources: ['src/store/userCommands.ts (createUser, updateUser, toggleUserActive, setUserOverride)', 'src/auth/password.js (hashPassword)'],
    routes: 'GET / (list users WITHOUT passwordHash), POST / { name, email, password, role, assignedUnitIds } (hash password -> passwordHash), PUT /:id (update name/role/assignedUnitIds/email; optional password rehash), PATCH /:id/active { active }, PUT /:id/override { add, remove }. NEVER return passwordHash. requirePermission("users", …).' },
  { key: 'roles', mod: 'users', file: 'src/modules/roles/roles.routes.ts', export: 'rolesRouter',
    sources: ['src/store/roleCommands.ts (createRole, updateRolePermissions, renameRole, deleteRole, resetRole)', 'src/types/rbac.ts (seedRoleDefs, ROLE_PRESETS, clonePermissions)'],
    routes: 'GET / (list RoleDefs), POST / { name, description, permissions }, PUT /:id/permissions { permissions }, PUT /:id { name, description } (rename; builtin admin matrix is locked), DELETE /:id (only non-builtin; reassign? just block if users reference it -> conflict), POST /:id/reset (built-ins back to preset). requirePermission("users", …).' },
  { key: 'import', mod: 'import', file: 'src/modules/import/import.routes.ts', export: 'importRouter',
    sources: ['src/store/importCommands.ts (applyImport, partitionInwards, createImportedPart)', 'src/lib/mioImport.ts (groupMioRows types)'],
    routes: 'POST /preview { inwards: [...] , autoCreateParts } (return issues/summary via the ported preview logic), POST /apply { inwards, autoCreateParts, skipInvalid, targetUnitId } (create missing parts + inward/dispatch rows; return ImportSummary). Reuse the inward/dispatch creation shape from domain + registerCommands logic. requirePermission("import", …). Keep it pragmatic: accept already-parsed rows as JSON (no xlsx parsing on the server).' },
  { key: 'system', mod: null, file: 'src/modules/system/system.routes.ts', export: 'systemRouter',
    sources: ['src/store/persistence.ts (backup/export shape)', 'src/lib/seed.ts equivalent backend/src/db/seed.ts (seedState)'],
    routes: 'GET /backup (admin only — return the full state JSON via getDb()), POST /backup { state } (admin only — replaceState), POST /reset-demo (admin only — replaceState(seedState())). Guard all with: if (req.auth.user.role !== "admin") throw forbidden(). Import seedState from "../../db/seed.js" and replaceState from "../../db/repository.js".' },
]

const built = await parallel(
  MODULES.map((m) => () =>
    agent(`${CONVENTIONS}

TASK (phase 2 — module: ${m.key}). Create ${BACKEND}/${m.file} exporting \`${m.export}\`.
RBAC module key for requirePermission: ${m.mod ? '"' + m.mod + '"' : '(admin-only — guard by role, see routes)'}.
Port business logic from these frontend sources (read them in ${FRONTEND}):
  - ${m.sources.join('\n  - ')}
Implement these routes:
  ${m.routes}
Remember: do NOT mount in app.ts, do NOT edit any file other than ${m.file} (create folders as needed).
Use the ported shared math in ${BACKEND}/src/domain/* where relevant.`,
      { label: `mod:${m.key}`, phase: 'Module routers' }
    ).then((summary) => ({ key: m.key, mount: '/api/' + (m.key === 'roles' ? 'roles' : m.key), export: m.export, file: m.file, summary }))
  )
)

const ok = built.filter(Boolean)

// ── Phase 3: integration — wire app.ts, typecheck whole backend, fix ─────────────
phase('Integration')
const mountList = ok
  .map((b) => `  ${b.export}  ->  app.use('${b.mount}', ${b.export})  // from '${b.file.replace('src/', './').replace('.ts', '.js')}'`)
  .join('\n')

const integration = await agent(`You are integrating the freshly-built module routers into the HEW ERP backend at ${BACKEND}.

These routers were created (export name -> intended mount -> source file):
${mountList}

Do ALL of the following:
1. Edit ${BACKEND}/src/app.ts to import each router (relative '.js' paths) and mount it at its path, replacing the
   placeholder comment block. Keep the existing /api/health, /api/auth, /api/masters mounts. Mount order: auth, masters,
   rates, inward, dispatch, invoices, payments, stock, scrap, expenses, rejection, attendance, reports, users, roles, import, system
   (only those that exist). For 'roles' mount at '/api/roles', 'users' at '/api/users', 'reports' router at '/api/reports'
   (it defines its own /dashboard/kpis sub-path — if the router exposes dashboard routes, also mount it at '/api' OR adjust;
   read the router to see its declared paths and mount so they resolve correctly).
2. From ${BACKEND}, run \`npx tsc -p tsconfig.json --noEmit\` and FIX every type error across all src/modules/* and src/domain/*
   files until it exits 0. Prefer minimal, correct fixes; do not weaken types with broad \`any\` unless a frontend port
   genuinely used a cast there. Do not change the foundation files' public APIs.
3. Re-run tsc to confirm exit 0.
Return: the final tsc result (clean or remaining issues), the list of mounted routes, and any modules you had to stub/disable to reach a clean build (name them explicitly).`,
  { label: 'integration', phase: 'Integration' })

return { domainPort: sharedPort, modules: ok.map((b) => ({ key: b.key, mount: b.mount })), integration }
