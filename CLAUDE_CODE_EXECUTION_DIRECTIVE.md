# Execution Directive — Build Everything in One Pass, Test Hard, Zero UI Bugs

> Paste this **immediately after** `CLAUDE_CODE_BUILD_PROMPT.md`. It overrides the phased "stop and wait" cadence: you still write `plan.md` and `status.md` first, but then you build the **entire application end-to-end in one continuous effort** and you do not declare anything "done" until it is tested and bug-free.

---

## 0. What changed from the base prompt

- The base prompt let you ship phase-by-phase. **You no longer pause between phases.** After I approve `plan.md`, build P0 → P9 in one disciplined, continuous pass.
- **Testing is no longer "Phase 9 polish." It is a gate on every module.** A feature is not complete until its tests pass and you have manually verified it in the running app with zero console errors and zero broken interactions.
- Your title is **Senior Frontend Engineer.** The last build had too many UI bugs. That is on the engineer, not the framework. This pass, you own quality. Sloppy, half-wired, or visually broken output is a failure regardless of feature count.

---

## 1. Definition of Done (applies to EVERY screen and feature — no exceptions)

A feature is DONE only when ALL of these are true. If any is false, it is not done; keep working.

1. **It does what it claims, against real state.** Save persists, edit mutates, delete soft-deletes, calculations are correct, the value appears everywhere it should (derived selectors), and survives a page refresh.
2. **Zero console errors and zero warnings** in the browser console during normal use (no key warnings, no act() warnings, no uncaught promise, no missing-prop, no NaN rendered).
3. **Every interactive element works.** No dead buttons, no link to a 404 route, no dropdown that opens but selects nothing, no modal that won't close, no form that won't submit, no tab that shows blank. If it's clickable, it does its job.
4. **All states are handled and visibly correct:** loading, empty, error, disabled, hover, focus, no-results, over-limit/validation. Open every screen with (a) full data, (b) zero data, (c) filtered-to-nothing — all three must look intentional.
5. **Layout is not broken** at desktop (1440), laptop (1280), and tablet (768): no overflow spilling off-screen, no overlapping text, no zero-height containers, no table blowing the viewport, no clipped modals, no sticky header covering content.
6. **Numbers and money are correct and formatted:** Indian grouping, ₹, two-decimal currency with no float drift, dates `dd-MM-yyyy`, no `NaN`/`undefined`/`[object Object]` ever rendered.
7. **Its tests exist and pass** (see §3).
8. **`status.md` is updated** to mark it done with a one-line verification note.

Put this exact list at the top of `status.md` as the "DoD checklist" and apply it literally.

---

## 2. Build order within the single pass

Build in the base prompt's phase order (P0 scaffold → P1 masters → P2 inward/outward core → P3 import → P4 billing → P5 scrap+expense → P6 attendance → P7 reports → P8 RBAC → P9 polish) **but do not stop between them.** Rules for the continuous pass:

- **Vertical slices stay intact:** finish a module to its Definition of Done before moving on, so you're never carrying a pile of half-done screens (that's what produced the bug swarm last time).
- **Wire the data model and the store transactions (the §6 architecture from the base prompt) FIRST and correctly.** Most UI bugs are actually state bugs surfacing. A correct store makes the UI calm.
- **Reuse one set of design primitives everywhere.** Build Button/Input/Select/Dialog/Table/Badge/Tabs/Toast/EmptyState/Skeleton ONCE in P0, then never hand-roll a one-off. Inconsistent bespoke components are a top bug source.
- After each module reaches DoD, run the **regression sweep** (§4) before starting the next. Fix anything it breaks immediately — do not accumulate debt.

---

## 3. Testing — mandatory, not optional

Set up the test toolchain in P0 and write tests as you build each module (not at the end).

**Toolchain:** Vitest + React Testing Library + `@testing-library/user-event` + jsdom. Add `@testing-library/jest-dom` matchers. Optionally Playwright for 2–3 end-to-end happy-path flows if time allows, but unit/integration via Vitest is required.

**What to test (minimum bar per area):**

- **Store / business logic (highest priority — this is where correctness lives):**
  - Live stock derivation: `opening + Σinward − Σdispatch(ok+mcRej+mf)` for multiple parts.
  - `saveOutwardDispatch` transaction: inserts child dispatches, computes sub/gst/grand, creates/links draft invoice, advances invoice seq, logs activity — all atomically; rolls back fully on validation failure.
  - IGST vs CGST+SGST derivation from state codes (intra vs interstate).
  - GST snapshotting: editing a part's GST% later does NOT change an already-saved dispatch.
  - Packing box calc, scrap TCS calc, expense balance + instalments, attendance auto-calcs.
  - Undo: every transactional action reverts cleanly to prior state.
  - Reconciliation invariant: `Σdispatch.totalQty + closingStock === opening + Σinward` holds after random sequences of operations.
  - Money helper: no float drift (assert `53233.20`, never `53233.200000000004`).
  - RBAC `can(user, module, action)` matrix + unit-scoping: an operator's list selectors never return another unit's rows.
  - Excel parse+group: the "blank received-qty row = extra dispatch on previous challan" grouping produces the right parent/child tree from a sample MIO buffer.
- **Component / integration:**
  - Outward form: add 3 lines, totals + footer update live; pushing total past available stock disables save and shows the warning.
  - Inward form: required challan+heat validation; duplicate-challan guard fires.
  - Register: expanding a parent shows its dispatch children; filters narrow rows; empty-filter shows "no results."
  - Invoice builder: ticking challan-wise lines updates totals; issuer switch (unit vs vendor) swaps header data; PDF generates without throwing.
  - User mgmt: toggling a permission disables the corresponding button elsewhere; deactivating a user blocks access.
  - Persistence: write data → reload (re-hydrate store) → data intact.

**Coverage target:** 100% of store transactions and calculation helpers covered; every form and every table has at least one render + one interaction test. Put the count in `status.md`.

**The build is not finishable while any test is red.** `npm run test` must exit clean.

---

## 4. Self-QA passes you must run before declaring the whole app done

After the continuous build, run these explicit sweeps and **log each in `status.md` with findings + fixes**:

1. **Click-everything sweep:** visit every route, click every button, open every modal, every dropdown, every tab, submit every form (valid + invalid), trigger every bulk action. Record and fix every dead/broken interaction. Target: zero.
2. **Console-clean sweep:** with devtools open, repeat core flows; the console must stay empty of errors/warnings. Fix all.
3. **Empty/zero-data sweep:** reset to no data; every screen must render a proper empty state, never crash, never show `NaN`/blank tables with broken headers.
4. **Responsive sweep:** 1440 / 1280 / 768; fix all overflow, overlap, clipping, broken grids.
5. **Cascade-integrity sweep:** perform a dispatch save and confirm — in the same session — the register row balance, the stock figure, the dashboard KPI, the draft invoice, and the activity feed ALL updated correctly from that one action. Then Undo and confirm they all revert.
6. **Cross-browser sanity:** Chrome required; spot-check Firefox.
7. **Keyboard + a11y sweep:** Tab through a form and a table, ⌘K palette, Esc closes modals, focus rings visible, labels present.
8. **Reconciliation sweep:** import the real MIO sample, then verify every part's ledger reconciles (badge green) and the importer created the right parent/child counts.

Add a **"QA Log"** section to `status.md` capturing each sweep: date, what you checked, bugs found, bugs fixed, remaining (should be zero).

---

## 5. Anti-bug engineering rules (these prevent the last build's problems)

1. **TypeScript strict, no `any`, no `@ts-ignore`.** Type the store and props fully. Most UI bugs were untyped data shape mismatches.
2. **Never render unguarded:** every `.map` has a stable `key`; every possibly-undefined value has a fallback (`value ?? '—'`); never render an object; never divide without guarding zero.
3. **One formatting layer:** all money/date/number formatting goes through shared helpers. No ad-hoc `toFixed` scattered around.
4. **Controlled inputs only,** bound to RHF; no uncontrolled→controlled flip warnings.
5. **Selectors are memoized and stable;** don't create new object/array literals inside selectors that feed `useStore` (causes infinite re-render / flicker). This was likely a real cause of "UI bugs."
6. **Modals/dropdowns:** single source of open-state, close on Esc + backdrop + action, return focus to trigger, no body-scroll bleed, no stacked-modal z-index fights.
7. **Tables:** fixed layout where needed, sticky header tested, long content truncates with title tooltip, horizontal scroll contained — never let a table set the page width.
8. **Loading vs empty are different states** — never show "empty" while data is still hydrating, and never show a spinner forever.
9. **Error boundaries** around each route so one screen's crash never white-screens the app; show a recoverable fallback.
10. **No dead code, no commented-out blocks, no leftover console.logs** in the final pass.

---

## 6. What to deliver and how to report

- Build the whole app to the Definition of Done across all modules.
- Keep `status.md` current throughout: DoD checklist, per-module done-state with verification note, test count + pass status, and the QA Log of all 8 sweeps.
- **Final report to me must include:** (a) one-paragraph summary, (b) module-by-module DoD confirmation, (c) test summary (files, count, all green), (d) the QA Log with "bugs found → fixed," (e) any honest known-limitations (don't hide them), (f) exact run instructions (`install`, `dev`, `test`, `build`).
- **Do not tell me it's done unless §1 DoD is literally true for every module and `npm run test` and `npm run build` both pass clean.** If you run low on room, finish fewer modules *to DoD* rather than more modules half-broken — quality over count, every time.

Begin: confirm understanding in 5 lines, (re)generate `plan.md` reflecting the single-pass + testing-gate model and the updated `status.md` with the DoD checklist and empty QA Log, list only genuinely blocking questions, then start P0 and keep going.
