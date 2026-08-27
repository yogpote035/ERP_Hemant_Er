# HEW ERP — UI & Forms Documentation

In-depth reference for the **Hemant Engineering Works** Job-Work & Billing ERP.
Generated for the purpose of **updating / aligning the current frontend** against the
deployed Lovable UI mock.

## The three documents

| File | What it is | Use it to… |
|------|------------|-----------|
| [lovable-mock-ui-spec.md](./lovable-mock-ui-spec.md) | Route-by-route capture of the **deployed Lovable mock** ([industrial-forge-dash.lovable.app](https://industrial-forge-dash.lovable.app/)) — every page, what it shows, every CTA, every table column, KPIs, filters. | See the **visual / UX spec** the client signed off on. |
| [current-frontend-forms.md](./current-frontend-forms.md) | Every page **and every form** in the **actual React code** under `frontend/src` — full field tables (Label · key · type · required · options/validation) + computed fields, with `file:line` citations. | The **implementation reference** — the real, authoritative field lists. |
| [mock-vs-code-gap-analysis.md](./mock-vs-code-gap-analysis.md) | Route-by-route comparison of mock vs code + a prioritized **P1/P2/P3 update plan**. | Decide **what to add / rename / change** in the frontend. |

## Key facts to know before reading

1. **The Lovable app is a UI mock, not this codebase.** It is the visual spec. The real app
   (`frontend/`) has *more* modules (Payments, Scrap, Rejection Advice, Attendance & Payroll,
   Excel Import, Rate Masters, Users & Roles/RBAC, multi-unit switching) and *omits* some mock
   pages (a dedicated Settings page, a standalone Vendors list, a flat Billing list).

2. **Mock form fields could not be auto-read.** The mock's create/edit forms are modals behind
   buttons; a static fetch cannot open them. So the **field lists are taken from the code**
   (the real implementation). The mock doc captures every page + every CTA and cross-references
   this doc for the fields.

3. **No PNG screenshots are embedded** (no browser-screenshot harness is wired into this tool,
   and the pages are external URLs). Instead, **each mock page has its live URL** — click it to
   view the real screen. To capture PNGs locally, use `frontend/scripts/shoot.mjs`
   (the Playwright harness) against the dev server.

## Conventions in the field tables

- **req** = required to submit the form.
- **type** = the rendered control: `text`, `textarea`, `number`, `money` (₹, step 0.01),
  `date`, `select` (searchable dropdown), `checkbox`, `time`, `file`.
- **options/validation** = dropdown choices and/or the Zod rule.
- Money is entered in **rupees** but **stored as integer paise**.
- `file:line` citations point into `frontend/src`.
