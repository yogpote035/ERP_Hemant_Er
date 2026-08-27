# Current Frontend — Pages & Forms (authoritative)

> Read from the actual code under `frontend/src`. This is the **real implementation** —
> the field lists here are authoritative (the Lovable mock's modal fields could not be
> auto-read). Stack: Vite + React 18 + TS, Zustand (immer+persist), React Router v6,
> RHF + Zod, TanStack Table, SheetJS, @react-pdf/renderer.
>
> **Conventions:** req = required · `money` = ₹ input stored as integer **paise** ·
> `select` = searchable dropdown. Citations point into `frontend/src`.

## Complete route table (`app/nav.ts`, `app/router.tsx`)

| Section | Path | Label | Module | Phase |
|---------|------|-------|--------|-------|
| — | `/` | Dashboard | dashboard | P0 |
| Operations | `/inward` | Inward / Outward | inward | P2 |
| Operations | `/dispatch` | Outward entry | dispatch | P2 |
| Operations | `/stock` | Stock | stock | P2 |
| Operations | `/import` | Excel Import | import | P3 |
| Billing & Finance | `/billing` | Billing | billing | P4 |
| Billing & Finance | `/payments` | Payments | payments | P4 |
| Billing & Finance | `/scrap` | Scrap Billing | scrap | P5 |
| Billing & Finance | `/rejection` | Rejection Advice | rejection | P5 |
| Billing & Finance | `/expenses` | Expenses | expenses | P5 |
| Workforce | `/attendance` | Attendance & Payroll | attendance | P6 |
| Admin | `/masters` | Masters | masters | P1 |
| Admin | `/rates` | Rate Masters | rates | P1 |
| Admin | `/reports` | Reports | reports | P7 |
| Admin | `/users` | Users & Roles | users | P8 |
| — | `*` | NotFound | — | — |

**App shell** (`components/layout/`): collapsible **Sidebar** grouped by the sections above ·
**Topbar** with breadcrumb, **UnitSwitcher** (multi-unit scope: a unit or "All units"),
**ThemeToggle** (light/dark), **UndoRedo**, **UserMenu** · all authed routes are behind
`RequireAuth` + per-module `RequirePermission`.

> **Form infrastructure.** Master & transaction forms are schema-driven via a `FieldSpec[]`
> rendered by `components/form/AutoField.tsx` inside `components/form/RecordFormModal.tsx` /
> `masters/EntityManager.tsx`. Field kinds: `text`, `textarea`, `number`, `money`, `date`,
> `select`, `checkbox` (`masters/types.ts`). Each form has a Zod schema + `toForm`/`toEntity`
> mappers + optional `extraValidate` and `afterUpsert` hooks.

---

# 1. Masters (`/masters`) — `pages/Masters.tsx`, `masters/registry.tsx`

Tabbed CRUD. Each tab = a master entity with a list table + **Add** / row **Edit** / **Delete**
(soft-delete where noted) + **Export**.

### 1.1 Unit  — `registry.tsx:~59`  *(no soft-delete on history; not unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit name | name | text | ✓ | min 1 |
| Short code | code | text | ✓ | min 1, **unique** |
| GSTIN | gstin | text | ✓ | GSTIN regex; first 2 digits must equal stateCode |
| State code | stateCode | text | ✓ | `^\d{2}$` (27 = MH) |
| Invoice seq padding | seqPad | number | ✓ | int 1–8 |
| Invoice format | invoiceFormat | text | ✓ | template e.g. `HEW/{FY}/{seq}` |
| Address (one line each) | addressLines | textarea | – | newline → string[] |
| Bank name | bankName | text | – | |
| Account no. | accountNo | text | – | |
| IFSC | ifsc | text | – | |

> The Unit master **is the "company profile"** — GSTIN/PAN-area, invoice numbering, bank & address all live here (per unit).

### 1.2 Part  — `registry.tsx:~128`  *(soft-delete; unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Part number | partNo | text | ✓ | min 1, **unique per unit** |
| Material code | materialCode | text | ✓ | min 1 |
| Unit | unitId | select | ✓ | active units; cannot change once part has inward/stock/production history |
| UOM | uom | text | ✓ | min 1 (NOS / KG) |
| HSN/SAC | hsnSac | text | ✓ | min 1 |
| GST % | gstPct | select | ✓ | 5 / 12 / 18 / 28 |
| Finish weight (g) | finishWtG | number | ✓ | ≥0, step 0.001 (stored mg) |
| Scrap weight (g) | scrapWtG | number | ✓ | ≥0, step 0.001 (stored mg) |
| Avg qty / box | avgQtyPerBox | number | ✓ | int ≥1 |
| Category | category | text | – | |
| Edition no. | editionNo | text | – | |
| Description | description | textarea | – | colSpan 2 |

### 1.3 Vendor  — `registry.tsx:~217`  *(soft-delete; not unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Vendor name | name | text | ✓ | min 1 |
| Code | code | text | ✓ | min 1, **unique** |
| Type | type | select | ✓ | `rm` (raw material) / `service` |
| Contact person | contactPerson | text | – | |
| Phone | phone | text | – | |
| Email | email | text | – | valid email or blank |
| GSTIN | gstin | text | – | GSTIN regex or blank; state-code agreement |
| PAN | pan | text | – | |
| State code | stateCode | text | – | `^\d{2}$` or blank |
| City | city | text | – | |
| Pincode | pincode | text | – | |
| Address (one line each) | addressLines | textarea | – | colSpan 2 |
| Bank name / Account no. / IFSC | bankName / accountNo / ifsc | text | – | |
| Remarks | remarks | textarea | – | colSpan 2 |

### 1.4 Customer  — `registry.tsx:~303`  *(soft-delete; not unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Customer name | name | text | ✓ | min 1 |
| GSTIN | gstin | text | ✓ | GSTIN regex, **unique** |
| State code | stateCode | text | ✓ | `^\d{2}$`, must equal GSTIN first 2 digits |
| Payment terms (days) | paymentTermsDays | number | – | int ≥0 |
| Address (one line each) | addressLines | textarea | – | colSpan 2 |

### 1.5 Machine  — `registry.tsx:~358`  *(soft-delete; unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Machine number | machineNo | text | ✓ | min 1, **unique per unit** |
| Unit | unitId | select | ✓ | active units |
| Description | description | textarea | – | colSpan 2 |

### 1.6 Operation  — `registry.tsx:~403`  *(soft-delete; not unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Operation code | code | text | ✓ | min 1, **unique** |
| Description | description | textarea | – | colSpan 2 |

### 1.7 Employee  — `registry.tsx:~443`  *(soft-delete; unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Employee name | name | text | ✓ | min 1 |
| Employee code | empCode | text | ✓ | min 1, **unique** |
| Phone | phone | text | – | |
| Labour type | labourType | select | ✓ | `production` / `shift` / `both` |
| Standard shift rate | standardShiftRate | money | ✓ | ≥0 (paise) |
| Unit | unitId | select | ✓ | active units |

### 1.8 Opening stock  — `registry.tsx:~502`  *(no soft-delete; unit-scoped)*
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | active units |
| Part | partId | select | ✓ | active parts; part.unit must equal unitId |
| Financial year | fy | text | ✓ | `^\d{2}-\d{2}$` (e.g. 24-25) |
| Opening quantity | openingQty | number | ✓ | int ≥0 |
| As of date | asOfDate | date | ✓ | required; **one row per (unit, part)** |

---

# 2. Rate Masters (`/rates`) — `pages/Rates.tsx`, `registry.tsx`

Versioned rates; saving a new rate **supersedes** the prior current one for the same key.

### 2.1 RM rate  — `registry.tsx:~557`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Part | partId | select | ✓ | active parts, colSpan 2 |
| Rate per piece | rate | money | ✓ | ≥0 (paise) |
| Effective from | effectiveFrom | date | ✓ | supersedes prior rate for this part |

### 2.2 Production rate  — `registry.tsx:~602`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Part | partId | select | ✓ | active parts, colSpan 2 |
| Machine | machineId | select | – | active machines |
| Operation | operationId | select | – | active operations |
| Rate per piece | rate | money | ✓ | ≥0 (paise) |
| Effective from | effectiveFrom | date | ✓ | supersedes prior rate for (part+machine+operation) |

---

# 3. Inward / Outward register (`/inward`) — `pages/InwardRegister.tsx`

Parent/child register: a **challan (Inward)** parent expands to its **Dispatch** children.
Columns: part no, supplier, received, dispatched, available, balance pill
(In-house / Partial / Dispatched). CTAs: **New inward**, **Import**, **Export**, per-row
**add dispatch line**, edit, delete.

### 3.1 Material Inward form  — `components/register/inwardForm.ts:24`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | unitOptions |
| Part | partId | select | ✓ | partOptions |
| Challan no. | challanNo | text | ✓ | min 1 |
| Challan date | challanDate | date | ✓ | default **today** |
| RM supplier (vendor) | vendorId | select | – | vendorOptions |
| Customer / owner | customerId | select | – | customerOptions |
| Batch / heat no. | batchHeatNo | text | ✓ | min 1 |
| Received qty | receivedQty | number | ✓ | int > 0 |
| PO no. | poNo | text | – | |
| Die no. | dieNo | text | – | |
| Bin no. | binNo | text | – | |
| Remarks | remarks | textarea | – | colSpan 2 |

### 3.2 Dispatch / Outward form  — `components/register/DispatchForm.tsx:21`
Added per parent challan. The form shows **available-on-challan** live and blocks over-dispatch.
| Label | key | type | req | options/validation | shown when |
|-------|-----|------|-----|--------------------|------------|
| Type | kind | select | ✓ | `billed` / `rejection` | always |
| Bill no. / Rejection DC no. | billNo | text | ✓ if billed | label changes by kind | always |
| OK qty | okQty | number | – | int ≥0 | always |
| Machine-rej qty | mcRejQty | number | – | int ≥0 | always |
| RM-fault qty | mfQty | number | – | int ≥0 | always |
| Rate per piece (₹) | rate | number | ✓ if billed | ≥0; prefilled from latest production rate | billed |
| Customer invoice no. | custInvoiceNo | text | – | | billed |
| Bill date | billDate | date | – | default today | billed |
| Dispatch / return date | dispatchDate | date | – | default today | always |

**Rule:** `okQty + mcRejQty + mfQty` must be **> 0**, and total ≤ available on the challan.
**Computed / frozen at save:** total qty (display) · available qty (display) ·
`rateSnapshotPaise` · `gstPctSnapshot` (from the Part) — the latter two freeze price/tax for billing.

---

# 4. Stock (`/stock`) — `pages/Stock.tsx`, `selectors/register.ts`

**Read-only, fully derived** ("opening + received − consumed", never stored). No form.
- Sub-title: "Derived from openings, inwards and dispatches — never stored."
- **Table columns:** Unit · Part · Opening · Received · Consumed · **Available** · **Reconcile** (OK / Imbalanced badge).
- Empty state prompts adding parts / opening stock / inward challans.

---

# 5. Billing (`/billing`) — `pages/Billing.tsx`, `selectors/billing.ts`, `selectors/invoiceCompute.ts`

List of invoices per **Bill No** with draft → finalize → sent lifecycle. CTAs: **Finalize**
(draft), **Preview / PDF**, **GSTR export**, reverse.

### 5.1 Invoice Finalize drawer  — `Billing.tsx:243` (`InvoiceBuilder`)
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Consignee (Bill to) | customerId | select | ✓ | active customers (GSTIN + state) |
| Issued by | issuerKind | select | – | `unit` / `supplier` (drives tax) |
| RM supplier | issuerVendorId | select | ✓ if issuerKind=supplier | active RM vendors |
| Invoice date | invoiceDate | date | – | defaults to invoice.invoiceDate |

**Read-only inside the drawer:** packing-box line table (Part No · Challan · Qty · Rate · Amount).
**Computed totals** (`invoiceCompute.ts`): Assessable = Σ line amounts · CGST+SGST **or** IGST
(by `deriveTaxKind` = intra/inter-state) · Round-off (to nearest ₹) · **Grand total**.
Save disabled unless customer set, ≥1 line, and (if supplier) issuerVendorId set.

---

# 6. Payments (`/payments`) — `pages/Payments.tsx`, `store/billingCommands.ts`

One receipt can settle **several** bills (multi-allocation). CTAs: **Record payment**
(disabled when nothing outstanding), per-row **Reverse** (restores bills' outstanding, undoable).
- **List columns:** Date · Mode · Ref · Amount · Allocated to (bills + amounts) · Reverse.

### 6.1 Record payment drawer  — `Payments.tsx:149` (`RecordPaymentModal`)
**Header fields**
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Mode | mode | select | – | rtgs / neft / cheque / upi / cash / bank (default rtgs) |
| Ref / UTR / cheque no | ref | text | – | trimmed |
| Date | date | date | – | default today |

**Allocation table** (one row per outstanding bill): Bill · Customer · Outstanding ·
**Allocate** (number ₹, per bill) · **full** link (fills the row's full outstanding).
- **Payment total** = Σ allocations (live). Save = "Receive ₹total"; disabled until ≥1 allocation > 0.

---

# 7. Scrap Billing (`/scrap`) — `pages/Scrap.tsx`, `lib/scrapMath.ts`

Inline card form (not a drawer). Computes a scrap-sale invoice with GST **and TCS**.

### 7.1 Scrap bill form  — `Scrap.tsx`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | unitOptions |
| Customer | customerId | select | ✓ | customerOptions (scrap buyer) |
| Invoice no | invoiceNo | text | ✓ | trimmed |
| Invoice date | invoiceDate | date | – | default today |
| Period from | periodFrom | date | – | defaults to invoiceDate |
| Period to | periodTo | date | – | defaults to invoiceDate |
| Weight (kg) | kg | number | ✓ | > 0 (stored as grams) |
| Rate / kg (₹) | rate | money | ✓ | > 0 (paise) |
| GST % | gst | number | – | default 18 |
| TCS % | tcs | number | – | default 1 |

**Computed (live):** Value = rate × kg · GST = Value × gst% · **TCS = (Value + GST) × tcs%** ·
**Grand = Value + GST + TCS** (`computeScrap`).

---

# 8. Rejection Advice (`/rejection`) — `pages/RejectionAdvice.tsx`

Delivery challan for rejected material returned to the customer.

### 8.1 Rejection advice drawer  — `RejectionAdvice.tsx:121` (`RejectionForm`)
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Source challan | sourceInwardId | select | ✓ | inwards (resolves unit + part) |
| Customer | customerId | select | ✓ | active customers |
| Rejection DC no | rejDcNo | text | ✓ | trimmed |
| Date | rejDate | date | – | default today |
| MR qty | mrQty | number | ✓ | int ≥0 |
| FR qty | frQty | number | ✓ | int ≥0 |
| Weight basis | weightBasis | select | – | `finish` / `scrap` (per-ring weight source) |
| Computed weight | weightKg | number (disabled) | — | read-only |

**Rule:** `mrQty + frQty` must be **> 0**.
**Computed:** perRingMg from part (snapshotted on edit) → weightKg = (mrQty+frQty) × perRingMg / 1e6.

---

# 9. Expenses (`/expenses`) — `pages/Expenses.tsx`, `selectors/finance.ts`

Overheads with instalment tracking. CTAs: **New expense**, row **Edit**, row **Pay** (if balance > 0).
- **Derived per row:** Paid (Σ instalments) · Balance · Status (unpaid / partial / paid / **overdue** if past dueDate).

### 9.1 Expense form (drawer)  — `Expenses.tsx:142`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | unitOptions |
| Vendor (optional) | vendorId | select | – | vendorOptions |
| Category | category | text | ✓ | trimmed (Power, Freight, Rent…) |
| Total payable (₹) | total | number | ✓ | > 0 (→ paise) |
| Date | date | date | ✓ | default today |
| Due date (optional) | dueDate | date | – | drives overdue status |

### 9.2 Pay expense (modal)  — `Expenses.tsx:223`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Amount (₹) | amount | number | ✓ | > 0 (→ paise) |
| Mode | mode | select | – | rtgs / neft / cheque / upi / cash / bank (default rtgs) |
| Ref | ref | text | – | cheque no / UTR / txn ref |
| Date | date | date | – | default today |

Appends to `expense.instalments[]`.

---

# 10. Attendance & Payroll (`/attendance`) — `pages/Attendance.tsx`, `selectors/attendance.ts`

Tabs: **Production** · **Shift** · **Earnings** (rollup). Two inline entry forms.

### 10.1 Production entry  — `Attendance.tsx:51`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | unitOptions |
| Date | date | date | ✓ | default today |
| Employee | employeeId | select | ✓ | unit + type=production |
| Machine | machineId | select | ✓ | unit machines |
| Part | partId | select | ✓ | unit parts |
| Operation | operationId | select | – | operationOptions |
| Opening counter | opening | number | ✓ | int ≥0 |
| Closing counter | closing | number | ✓ | int ≥0 |
| OK qty | okQty | number | ✓ | int ≥0 |

**Computed:** Made = max(0, closing − opening) · Rate = latest production rate · Earned = okQty × rate.
Save disabled until unit/employee/machine/part set, rate known, and made > 0.

### 10.2 Shift entry  — `Attendance.tsx:169`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Unit | unitId | select | ✓ | unitOptions |
| Date | date | date | ✓ | default today |
| Employee | employeeId | select | ✓ | unit + type=shift |
| From | fromTime | time | ✓ | default 09:00 |
| To | toTime | time | ✓ | default 17:00 |
| OT hours | otHours | number | – | step 0.5, ≥0 |
| OT rate / hr (₹) | otRate | number | – | ≥0 (paise) |

**Computed:** Hours = minutesBetween(from,to)/60 · Wage = (hours/8) × standardShiftRate + otHours × otRate.

---

# 11. Excel Import (`/import`) — `pages/ImportWizard.tsx`, `lib/mioImport.ts`

3-step wizard, one **undoable** transaction at the end.

**Step 1 — File & unit**
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Workbook file | file | file (.xlsx/.xls) | ✓ | parsed client-side (SheetJS) |
| Sheet | sheet | select | ✓ | workbook sheet names |
| Target unit | unitId | select | ✓ | unitOptions |

**Step 2 — Column mapping:** map each of the **16 MIO target fields** to a sheet column
(auto-detected; "Not mapped" = −1). Required: challanNo, challanDate, partNo, batchHeatNo,
receivedQty. Optional: poNo, rmRate, billNo, billDate, okQty, mrQty, mfQty, ratePerPc,
dispatchDate, custInvoiceNo, custInvoiceDate.

**Step 3 — Preview & import:** read-only stats (Challans · Dispatches · Received qty · Billed/OK qty ·
Rejection qty) + error/warning list. **Import** disabled if any error or 0 challans.

---

# 12. Users & Roles (`/users`) — `pages/Users.tsx`, `store/userCommands.ts`, `store/roleCommands.ts`, `types/rbac.ts`

Two tables (Users, Roles) with **New user**, **New role**, per-row Edit, and **permission-matrix**
(key icon) editors.

### 12.1 User form (drawer)  — `Users.tsx:211`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Name | name | text | ✓ | min 1 |
| Email | email | text (email) | ✓ | valid email, **unique** |
| Role | role | select | ✓ | built-in admin/manager/operator + custom roles |
| Assigned units | assignedUnitIds | checkbox group (multi) | ✓ if non-admin | active units (admin = all, field skipped) |

Guards: last active admin cannot be demoted; non-admin needs ≥1 unit.

### 12.2 Role form (drawer)  — `Users.tsx:559`
| Label | key | type | req | options/validation |
|-------|-----|------|-----|--------------------|
| Role name | name | text | ✓ | unique (case-insensitive) |
| Description | description | text | – | |
| Clone permissions from | cloneFromId | select | – | (create only) existing role |

Built-in roles (admin/manager/operator) cannot be renamed.

### 12.3 Permission matrix (role-level & per-user override)  — `Users.tsx:495` / `:310`
Checkbox grid of **MODULES × ACTIONS**. Admin row is locked (always full access). Per-user
overrides are stored as add/remove deltas vs the role preset; empty override = role defaults.

- **MODULES (15):** dashboard, inward, dispatch, stock, billing, payments, scrap, rejection, expenses, attendance, masters, rates, reports, users, import
- **ACTIONS (6):** view, create, edit, delete, export, approve

**Built-in defaults** (`rbac.ts`): **admin** = all · **manager** = broad create/edit/export
(no users; no delete on some) · **operator** = view + create on transactions, view-only on
masters/rates, no users.

---

# 13. Dashboard (`/`) — `pages/Dashboard.tsx`, `selectors/kpi.ts`

- **Reconcile pill:** "Stock reconciled" / "N imbalances".
- **4 KPI cards:** Open challans (of total inward) · Revenue invoiced (incl. GST) · Outstanding
  (+ overdue count) · Draft invoices.
- **Recent activity** list (audit trail: summary · user · command · timestamp).
- **Lowest available stock** list (5 parts, colored badge).

---

# 14. Reports (`/reports`) — `pages/Reports.tsx`, `selectors/reports.ts`

Searchable card grid; each card opens a **drawer** with the table + exports.
- **Tabs:** All · Operations · Finance · Workforce (with counts). **Search** box.
- **7 reports:** Inward vs Outward · Billing summary · Customer revenue · Stock · Scrap ·
  Expenses · Attendance earnings.
- **In each report drawer:** Export **Excel**, Export **CSV**, **Print / PDF**; date-range
  **From / To** filter (only on date-filtered reports); config strip (Category · Scope · Rows ·
  Date range); the data table (columns defined per report).

---

## Gaps / notes
- There is **no `/settings` page** — company/invoicing config lives in the **Unit master** (§1.1).
- **Vendors/Customers** are **Masters tabs**, not standalone top-level pages.
- **Billing** is a draft→finalize lifecycle (not a flat invoice list); **Payments** is its own page.
- Line numbers in §1–§2 are approximate (`registry.tsx`); other citations are exact.
