# PRODUCTION READINESS — HEW ERP frontend

Legend: ✅ done · 🟡 partial · ⬜ not started · n/a not applicable

| Area | State | Notes |
|------|-------|-------|
| **Build / typecheck** | ✅ | `tsc -b` strict (+`noUncheckedIndexedAccess`) and `vite build` green. |
| **Testing** | 🟡 | 20 unit tests (money + command-bus/undo/scope). Need: selector, reconcile, importer-grouping, component, and e2e coverage. |
| **Money correctness** | ✅ | Integer paise everywhere; float-drift + scrap-TCS golden tests; one money module. |
| **Security (auth)** | 🟡 | Mock auth by design (frontend-only). RBAC `can()` + scoping choke point exist; route/action guards land with the shell. localStorage-editable — documented constraint. |
| **Performance** | ⬜ | Plan: memoized selectors, TanStack Virtual on register/reports, debounced persist, code-split routes + lazy xlsx/pdf. |
| **Realtime** | n/a | No backend; no Socket.IO. (Would be added with a backend phase.) |
| **API coverage** | n/a | No backend; all data is local store + Excel import/export. |
| **Accessibility** | ⬜ | Token-based focus rings in base CSS; full AA audit (axe) at P9. |
| **Mobile / responsive** | ⬜ | Tablet-down target; sticky-first-col tables + single-col form reflow at P9. |
| **Browser compat** | 🟡 | Modern evergreen (Vite ES2022 target). |
| **Persistence / backup** | ⬜ | Persist wired (`hew-erp-v1`); Reset + JSON backup export/import + migration chain pending (seed milestone). |
| **Reconciliation** | ⬜ | Corrected I1–I3/I5 engine is the next task; the trust feature. |
| **Error handling** | 🟡 | ErrorBoundary to be adapted; per-route boundaries + empty/loading/error states at P9. |
