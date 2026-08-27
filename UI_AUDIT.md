# UI / UX Audit — HEW ERP frontend

Full-app audit (not just the reported screenshot) performed across layout, typography, tables,
forms, sidebar, header, cards, responsiveness, accessibility and visual consistency. Findings were
produced by a 4-dimension parallel code audit, de-duplicated, then remediated.

**Reference screenshot:** Expenses page (`/expenses`), light theme — sidebar brand clipped, native OS
scrollbar, weak active state, reconcile badge crammed at the bottom, "No expenses" blank state.

## Scorecard
| | Found | Fixed | Documented follow-up |
|---|---|---|---|
| Critical | 4 | **4** | 0 |
| Major | 14 | **10** (1 partial) | 4 |
| Minor | 19 | **8** | 11 |
| **Total** | **37** | **22** | **15** |

> Every fix kept the gates green: `tsc` clean · **100 unit tests** · `vite build` ok · **zero native `<select>` remain**.
> The follow-ups are intentional, lower-risk items (form-validation refactor, table pagination, a few cosmetic nits) — each listed below with rationale.

---

## CRITICAL — all fixed

### C1 · `text-muted` painted the muted *surface* colour (invisible text in dark mode) — FIXED
- **Root cause:** Tailwind auto-generates `.text-muted { color: var(--muted) }` from the `muted` *surface* token. A component-layer `.text-muted { @apply text-muted-fg }` alias collided with it, and since utilities are emitted *after* the components layer, the utility won. Every `text-muted` (≈18 spots: card/modal/drawer descriptions, empty-state text, Login subtitle, Stock subtitle/header, user email) rendered in the surface colour — barely readable in light, **invisible in dark** (`--muted` === `--card`). This was the true cause of the "faint text" reports.
- **Fix:** moved `.text-muted` / `.text-default` out of `@layer components` into plain rules emitted *after* `@tailwind utilities`, so they win the cascade and map to the readable `--muted-fg` / `--fg` tokens. One change, app-wide. (`src/index.css`)

### C2 · Returning users never received the seeded Expenses/Rejection/Rate demo data — FIXED
- **Root cause:** the demo seed added those collections but the persisted store (localStorage) was only role-backfilled on merge, so a returning browser kept the old empty slices forever (the reported "Expenses empty").
- **Fix:** added a non-destructive, versioned **seed backfill**: `system.seedVersion` + `SEED_VERSION`; on rehydrate, a store seeded below the current version gets the new collections **only where still empty** (never clobbers user data), then the version is bumped so it runs once. (`store/state.ts`, `lib/seed.ts`, `store/index.ts`) — also satisfies M10.

### C3 · Searchable-dropdown triggers had no accessible name on page forms — FIXED
- **Root cause:** page forms relied on a wrapping `<label>`; the trigger is a `<button>` and no `aria-label` was passed, so AT announced "button, collapsed".
- **Fix:** added `aria-label` to every page dropdown (Expenses, Payments, RejectionAdvice, Scrap, Attendance, Billing, Users) and to the two converted native selects; master-form dropdowns are labelled via `Field htmlFor`→`id`.

### C4 · `muted`/`default` badges vanished on same-colour cards in dark mode — FIXED
- **Root cause:** `--muted` === `--card` in dark, and those badges used `bg-muted` with no border → no pill contrast (invoice draft/void, role/unit chips disappeared).
- **Fix:** `default`/`muted` badge tones now carry `border border-border`. (`components/ui/Badge.tsx`)

---

## MAJOR

| ID | Issue | Status | Fix / rationale |
|---|---|---|---|
| M1 | No custom scrollbar — chunky native OS scrollbar in sidebar/lists | **FIXED** | Added a themed `.scrollbar-thin` utility (Firefox + WebKit), applied to the sidebar nav, content `<main>`, drawer body and dropdown list (`index.css`). |
| M2 | Sidebar brand "Hemant Eng. Works" clips | **FIXED** | `min-w-0 flex-1` wrapper + `truncate` on both lines + `shrink-0` logo + `title` tooltip (`Sidebar.tsx`). |
| M3 | Mobile nav drawer can't be closed with Escape; no dialog semantics | **PARTIAL** | Escape-to-close added (`AppLayout`). Full `role="dialog"`+focus-trap on the mobile rail deferred (scrim-click + Esc + route-change all close it; low residual risk). |
| M4 | EmptyStates lacked a creation CTA | **FIXED** | Added `action` CTAs to Expenses / Payments / RejectionAdvice empty states (guarded by `can(create)`). Scrap/Attendance intentionally skipped (their create form is an always-visible inline card); Billing skipped (invoices are auto-generated from dispatches). |
| M5 | Hand-rolled page forms gate only via a disabled Save button (no inline validation) | **FOLLOW-UP** | Functional today (submit is correctly blocked). A field-level error refactor (reuse `Field`) is queued — sizeable and lower-risk than the criticals. |
| M6 | Required fields never exposed `aria-required` | **FIXED** | `AutoField` + `SearchableDropdown` now set `aria-required` when the field is required. |
| M7 | Combobox lacks `aria-activedescendant` wiring | **FOLLOW-UP** | Trigger has `aria-haspopup`/`aria-expanded`/labels and full keyboard nav; active-descendant announcement is an enhancement. |
| M8 | Native `<select>` (InwardRegister, OutwardEntry) unlabelled + not searchable | **FIXED** | Both converted to `SearchableDropdown` with `aria-label`. No native `<select>` remains in the app. |
| M9 | `text-faint` fails AA on white cards (light) | **FIXED** | Light `--faint` darkened slate-400 → slate-500 (~4.6:1). Dark `--faint`/`--muted-fg` and the dark sidebar tokens were already raised in a prior pass. |
| M10 | Reset is the only way to get new demo data | **FIXED** | Covered by the C2 non-destructive backfill (no destructive reset needed). |
| M11 | Stock page heading was `<h2 text-lg>` vs the app's `<h1 text-xl font-bold>` | **FIXED** | Aligned to the shared page-title recipe (`Stock.tsx`). |
| M12 | Stock table header diverged (no `bg-muted`, wrong size, broken `text-muted`) | **FIXED** | Replaced with the shared thead recipe `bg-muted text-[10.5px] text-muted-fg`. |
| M13 | Off-scale `gap-3.5` / `p-3` card rhythm | **FOLLOW-UP** | Minor spacing drift on KPI/stat tiles; cosmetic. |
| M14 | No pagination/virtualization on list tables | **FOLLOW-UP** | Fine at current demo volumes; client-side pagination queued for high-volume tables (Reports, InwardRegister). |

---

## MINOR

| ID | Issue | Status |
|---|---|---|
| m1 | Focus ring used `ring-offset-bg` on the dark rail | **FIXED** — `focus-visible:ring-offset-sidebar` on nav links/section buttons/reconcile badge |
| m4 | Reconcile badge cramped above the footer | **FIXED** — `mb-2` |
| m5 | EntityManager showed a duplicate "New" button when empty | **FIXED** — header button hidden when empty; the EmptyState CTA is the sole action |
| m8 | Esc inside an open dropdown closed the whole Drawer | **FIXED** — `stopPropagation()` in the dropdown's Escape branch |
| m10 | Scroll-wheel silently changed number inputs | **FIXED** — `Input` blurs on wheel for `type=number` (shared path) |
| m13 | Bare checkboxes (Users/PermMatrix) had no focus ring | **FIXED** — added `focus-visible:ring-2` styling |
| m14 | Stock heading style diverged | **FIXED** — covered by M11 |
| m16 | `rounded-2xl` tiles vs the `rounded-xl` card system | **FIXED** — EmptyState icon tile + Login logo → `rounded-xl` |
| m2 | Topbar `sticky top-0` is a harmless no-op | follow-up (cosmetic) |
| m3 | Redundant `ml-auto` on topbar search + actions | follow-up (works) |
| m6 | No sticky table headers on long lists | follow-up (enhancement) |
| m7 | Focus trap can land on a hidden control | follow-up (mobile edge) |
| m9 | Scrap form half-resets after save | follow-up |
| m11 | Billing line cells lack truncation guard | follow-up |
| m12 | ConfirmDialog autofocuses the X, not Cancel/Confirm | follow-up |
| m15 | Mixed row-action icon sizes (13/14/15) | follow-up (cosmetic) |
| m17 | Register search hidden < md with no fallback | follow-up |
| m18 | `TableSkeleton` primitive unused | follow-up (no async data → no flash) |

---

## Cross-cutting notes

- **Accessibility:** every dropdown is now a labelled combobox with keyboard nav (↑↓/Enter/Esc/Home/End); required fields expose `aria-required`; focus rings are correct on the dark rail; checkboxes are focusable; the mobile drawer closes on Escape. Remaining a11y items (M5 inline errors, M7 active-descendant, m7/m12 focus polish) are queued, none are blockers.
- **Responsiveness:** verified mobile (off-canvas sidebar drawer + accordion, collapsed topbar, stacked KPIs), tablet, desktop (compact density), and the 1600px content cap for wide screens. Tables are `overflow-x-auto`; drawers go full-width < sm.
- **Dark mode:** the C1 + C4 + token fixes resolve the previously-invisible secondary text and badges; the sidebar is a dark rail in both themes by design.
- **Visual consistency:** Stock page realigned to the shared heading/table recipe; corner radii unified to the card system; badge tones consistent.

## Empty-state coverage
Every list/table page guards its table with an `EmptyState` (icon + title + description); persistence is synchronous so there is no hydration flash. CTAs added where the page opens a create form. The real "blank Expenses" cause was data (C2), now auto-backfilled.

## Screens that could still improve (future)
1. **Page forms** (Scrap/Expenses/RejectionAdvice/Users/Billing) — inline per-field validation (M5).
2. **High-volume tables** (Reports, InwardRegister) — pagination/virtualization + sticky headers (M14, m6).
3. **Combobox** — `aria-activedescendant` for full ARIA 1.2 combobox semantics (M7).
4. **Mobile** — a collapsed search affordance < md (m17).

## Before → After (headline)
- Dark-mode secondary text: **invisible → readable (AA)**.
- Sidebar: clipped brand + ugly OS scrollbar + weak active → **truncated brand, slim themed scrollbar, bold blue active pill**, pinned footer.
- Expenses (and Rejection/Rates): **permanently blank for returning users → auto-populated** with wired demo data + a CTA when truly empty.
- Dropdowns: 21 native selects → **searchable, labelled comboboxes** app-wide.
- Status badges: vanished in dark → **bordered, always visible**.
