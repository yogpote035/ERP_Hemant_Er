# plan.md — Job Work Management & Billing ERP (Hemant Engineering Works)

**Frontend-only · Vite + React 18 + TypeScript (strict) · Zustand · Client: Hemant Engineering Works (HEW), Pune · By: Zonixtec IT Services**

> Status: **awaiting approval.** Do not start P0 code until this plan is approved. Living progress is tracked in [status.md](status.md).

---

## 1. Project summary & the corrected data-model rationale

A centralized, **frontend-only** admin panel that digitizes HEW's full job-work workflow. HEW is a multi-unit forging/machining shop that processes **customer-owned** raw material (Rolex Rings, Yenkays, SKF…) and bills for the **machining (job work)**, not the material. The whole app runs in the browser on one normalized Zustand store persisted to `localStorage` — no backend, no API. Every feature works end-to-end against state: save, edit, delete, calculate, import (real Excel), export (xlsx/PDF).

The core loop: **Customer sends raw material → recorded as Inward (against a challan + heat no) → machined → dispatched out in one or more lots → each lot billed → GST invoice → payment tracked → live stock reconciled.** Scrap is sold separately (with TCS); labour is tracked by machine production or by shift.

**Why the SRS model is wrong, and what the real data proves.** The SRS modeled outward as a flat list. The **real `ROLEX RING LIMITED MIO 2025-26.xlsx`** (sheet `ROLEX-2026`, 26 columns, header row 4, ~490 rows) proves the true shape, which this build follows instead:

| Truth (from real data) | Evidence in the file |
|---|---|
| **Inward (parent) 1—* Dispatch (child)** is the spine. | Rows sharing a `Delivery Challan No` = one Inward; the first row carries `Received QTY`, later same-challan rows have **blank** Received QTY = additional dispatch lots. Challan `8202421273` → 1 inward of **28000** with **4** dispatch children (12020, 14000, **242 rejection**, 1738) that sum to exactly 28000. |
| A **Bill No spans many challans** and a **challan spans many bills**. | Bill `254/24-25` appears on challans 8202421270/8202421381/8202421534; challan 8202421273 carries bills `255/24-25` **and** `268/24-25`. ⇒ the invoice grain is **per Bill No**, not per challan (see §3). |
| **Rejection** lots consume stock but are **not billed**. | Bill `DC14`/`DC15` rows: SKF Dispatch Qty = 0, MR/MF > 0, no Rate, no amount. |
| **Per-line rates** on one bill. | Same bill: `OM-6308-A-2RS` @ 7.95 vs the `-N` variant @ 8.25. ⇒ rate must be **snapshot per dispatch line**. |
| **GST % is per part, configurable** — never hardcode. | Rolex register charges **IGST 12%**; HEW invoices to others charge **18%**; scrap is **18%**. |
| **IGST vs CGST+SGST is derived from state codes.** | HEW GSTIN `27ADGPV9846A1Z6` (state 27, Maharashtra) vs Rolex `24AACCR3790B1ZO` (state 24, Gujarat) → **IGST**. |
| **Money must be integer paise.** | Real cells show float drift: `61301.99999999999`, IGST `7356.239999999999`. |
| **Stock = Σ received − Σ (ok + MR + MF).** | The `STOCK` pivot reconciles exactly: 1,731,080 − 1,554,159 = **176,921**. |
| **Scrap → IGST 18% → TCS 1% on (value+GST).** | `Scrap Bill Record`: 7117 kg × 34.5 = 245,536.50 → IGST 44,196.57 → TCS 2,897.33 → **292,630.40**. |
| **Packing** = `ceil(totalOk / avgQtyPerBox)`. | `PART MASTER` carries `BAGS QTY` per part (e.g. OM-6308-A-2RS = 50, IM-6308-ALS = 80). |

---

## 2. Architecture: the unified cross-cutting contracts (single source of truth)

These contracts are deliberately fixed **once** here. They resolve real contradictions a multi-perspective design review surfaced (six competing money helpers, four store shapes, two invoice-creation workflows, a broken reconcile invariant). Every phase implements against **these**, not its own variant.

1. **One money module — `lib/money.ts` (integer paise, branded).** `type Paise = number & {__brand:'paise'}`. The *only* place float↔paise conversion happens. API (final, no aliases): `toPaise(rupees)`, `fromPaise(p)`, `addP(...xs)`, `mulQty(unitPaise, qty)`, `pctOfPaise(base, pct)`, `roundToRupee(p)`, `roundOffDelta(p)`, `formatINR(p)` (en-IN grouping `1,53,000.00`), `toWordsIndian(p)` (Lakh/Crore + “Only”). A lint/grep gate forbids `*100`/`/100` outside this file.
2. **CGST/SGST odd-paisa → CGST.** `cgst = ceil(total/2)`, `sgst = total − cgst` (Indian convention). One golden test pins the **direction** (not just `cgst+sgst===total`).
3. **One normalized store shape.** Every collection is `Normalized<T> = { byId: Record<Id,T>; allIds: Id[] }`. One root Zustand store, sliced by domain, wrapped `immer + persist` (key `hew-erp-v1`, `version`, `migrate`, debounced 800 ms write). `partialize` **excludes** the `session` slice, the undo/redo stacks, and any cached selector. Derived values are **never** persisted.
4. **Derived state is the architecture (Law A).** Stock, ledgers, invoice totals, KPIs, open balances, vendor outstanding, payment status, reconciliation are **memoized selectors** — never stored. The dispatch line stores only **snapshots** (`rateSnapshotPaise`, `gstPctSnapshot`, `billNo`) needed for historical immutability — it does **not** store `totalQty` or line money (those are derived).
5. **Dispatch has no `unitId`.** It is scoped only through its parent inward via the single choke point `scopedDispatches()`. (Storing a second `unitId` on the child invites desync after import/reassign and a cross-unit leak the leak-tests wouldn’t catch.)
6. **One unit-scoping choke point — `scopedBy(session,user)` / `allowedUnitIds()`.** Every list selector composes through it. Admin + “All units” = no filter; admin + specific unit narrows; non-admins are hard-filtered to `assignedUnitIds` regardless of the switcher. A leak test seeds another unit’s rows and asserts every scoped selector returns `[]`.
7. **One Module enum + role presets (single-sourced in `types/rbac.ts`).** `Module = dashboard | inward | dispatch | stock | billing | payments | scrap | rejection | expenses | attendance | masters | rates | reports | users | import`. `Action = view | create | edit | delete | export | approve`. Roles `admin | manager | operator` are presets → `PermissionSet`; admin can override per user (`overrides.add` / `overrides.remove`, remove wins). `can()` is the only check used by route guards, `<Can>`/`useCan`, and (defense-in-depth) inside store actions.
8. **One command-bus + one undo engine.** All multi-collection writes go through `runCommand(cmd,input)`: assert `can()` → `validate()` against a read-only state (zero mutation on failure) → apply in **one** `produceWithPatches` set (re-assert `can()` inside) → append `activityLog` → push **inverse patches** to an in-memory undo stack (depth 20, **not** persisted) → return a structured result for a rich sonner toast with **Undo**. Bulk import stores a coarse affected-slice snapshot.
9. **Invoice grain = per Bill No; the Bill No *is* the HEW GST invoice number.** Real data proves a bill no groups dispatch lines across challans and a challan splits across bills. So an **Invoice = the set of dispatch lines sharing `(unitId, issuer, billNo)`**. There is **one** numbering authority: the `{seq}/{FY}` Bill No (the SRS’s “INV-2025-001” in FR-BI07 is just an example format). Per **FR-BI01**, saving an outward dispatch **creates-or-attaches a DRAFT invoice** grouped by Bill No; the **Billing module finalizes** it (FR-B105/UC-06: pick consignee + issuer, tick challan-wise lines, generate the numbered PDF). The **consignee is chosen at billing time**, not stored on inward/dispatch (the SRS inward & outward forms carry no consignee field). (“Rolex Invoice No”, col 23, is the *customer’s own* reference, stored separately for reconciliation, never printed as ours.)
10. **One sequence counter, allocated atomically, never rolled back on undo.** `system.sequences["${issuerId}:${fy}"] → nextSeq`. FY is taken from the **bill/invoice date** (the document date the customer sees). Allocated inside the minting transaction. **Undo does not decrement it** (GST numbering tolerates gaps but must never reuse a number).
11. **`taxKind` is derived while draft, snapshot at issue.** A draft recomputes live; **issuing** an invoice freezes `taxKind` + totals onto the Invoice (legal immutability — the one deliberate exception to Law A). Derivation uses **issuer.stateCode** (unit *or* RM-supplier) vs customer.stateCode.
12. **Reconcile is a *real* bug-detector (corrected).** The naive identity `opening+received = consumed+closing` is algebraically always true when `closing := opening+received−consumed`, so it catches nothing. The genuine, falsifiable invariants are: **(I1)** per inward, `Σ children.totalQty ≤ received` (no over-dispatch against a challan); **(I2)** per `(unit,part)`, derived available `≥ 0` (no oversold); **(I3)** referential — every `dispatch.inwardId` resolves to an inward of the same `(unit,part)`, every billed line belongs to exactly one invoice, and `Σ invoice line amounts = Σ billable dispatch amounts`; **(I4)** import money cross-check vs the sheet’s own totals (warning); **(I5)** if an optional physical `StockSnapshot` exists, derived closing must equal it. The **Reconcile badge is RED** when any of I1–I3 (or I5) fails.
13. **Stock granularity = `(unit, part)`; grouping key = `(unitId, challanNo, partId)`.** ✅ Confirmed by the SRS: **FR-ST02** computes stock per *material* (no customer dimension) and **FR-RM03a** assigns each part to exactly **one** unit. Part numbers are customer-specific in practice, so `(unit, part)` does not pool across customers. The **consignee is an invoice-time selection**, not a stock dimension; `customerId` on an inward is optional (material-owner traceability only). *(If the client ever shares one part number across customers, we add the customer axis — see §9.)*
14. **Decimal-safe weights & rates.** Part `finishWt`/`scrapWt` stored as **integer milligrams**; scrap weight as **integer grams** (so `ratePerKgPaise × grams / 1000` is integer math, avoiding the fractional-kg float). Rates validated to **2 dp** at entry (stored as paise); 3-dp rates rejected with a clear error (millipaise upgrade noted if they ever appear).

---

## 3. Folder / architecture map

```
src/
  main.tsx  App.tsx  router.tsx
  app/        AppShell.tsx  CommandPalette.tsx  RequireAuth.tsx  RequirePermission.tsx  ThemeToggle.tsx
  routes/
    auth/Login.tsx
    dashboard/Dashboard.tsx
    register/RegisterPage.tsx          # CENTERPIECE: inward(parent)→dispatch(child) grid
    register/InwardForm.tsx  register/OutwardForm.tsx
    billing/InvoiceList.tsx  billing/InvoiceComposer.tsx
    scrap/ScrapPage.tsx  expenses/ExpensesPage.tsx
    attendance/AttendancePage.tsx      # Production | Shift tabs
    rejection/RejectionAdvicePage.tsx  # rejection DC back to customer
    masters/{Parts,Vendors,Customers,Units,Rates,OpeningStock}.tsx
    reports/ReportsPage.tsx  reports/ReconcileReport.tsx
    users/UsersPage.tsx  settings/SettingsPage.tsx   # reset/backup
  components/ui/      cn.ts cva.ts Button Input Select Badge Card Dialog ConfirmDialog
                     Tooltip Tabs Table Skeleton EmptyState Toast FilterChip MultiSelectToolbar
  components/register/  InwardRow DispatchSubRow BalancePill FilterBar SavedViews
  store/
    index.ts                          # create() + immer + persist('hew-erp-v1', version, migrate, debounce)
    slices/*.slice.ts                 # masters, inventory(inwards,dispatches), billing, payments,
                                      #   scrap, expenses, hr, rejection, system(sequences,activityLog,undo), session
    actions/*.ts                      # command-bus: saveInward, saveOutwardDispatch, mintBill/createInvoice,
                                      #   recordPayment, saveScrapBill, importMioWorkbook, deactivatePart, reassignPartToUnit, user actions
    commandBus.ts  undo.ts
  selectors/  stock.ts balance.ts billing.ts kpi.ts reconcile.ts reports.ts unit.ts customerLedger.ts
  lib/        money.ts  gst.ts  packing.ts  import/{parse,map,group,validate}.ts  pdf/{Invoice,Scrap,RejectionAdvice,Report}.tsx
              date.ts  id.ts  fy.ts  numberToWords.ts  seed.ts  backup.ts
  types/      domain.ts  rbac.ts  commands.ts
  styles/     tokens.css                # CSS-variable light/dark token layer (indigo/slate, --primary #2563eb)
  test/       fixtures/ (real 8202421273 group, scrap, drift), *.spec.ts
```

---

## 4. Data model (final entity types — store holds raw + snapshots only)

```ts
type Paise = number & {__brand:'paise'};  type Id = string;  type ISODate = string; // yyyy-MM-dd
type Normalized<T> = { byId: Record<Id,T>; allIds: Id[] };

Unit     { id; name; gstin; stateCode; addressLines[]; invoiceFormat; // 'HEW/{FY}/{seq}' | '{seq}/{FY}'
           bankName; accountNo; ifsc; logoDataUrl?; active }
User     { id; name; email; password? /*demo, ignored*/; role:'admin'|'manager'|'operator';
           assignedUnitIds:Id[]; overrides?:{add?:PermissionSet; remove?:PermissionSet}; active; createdAt }
Vendor   { id; name; code; type:'rm'|'service'; contactPerson?; phone?; email?;
           gstin?; pan?; stateCode?; addressLines[]; city?; pincode?;
           bankName?; accountNo?; ifsc?; invoiceFormat?; remarks?; active }              // 'rm' may be an invoice issuer (UC-01)
Customer { id; name; gstin; stateCode; addressLines[]; paymentTermsDays?; active }       // = consignee you bill
Part     { id; partNo; materialCode; description?; category?; editionNo?; unitId; uom; hsnSac; gstPct;  // GST%/HSN per part (UC-03), configurable
           finishWtMg; scrapWtMg; avgQtyPerBox; active }                                // weights in integer mg
StockOpening { id; unitId; partId; fy; openingQty; asOfDate }                           // per (unit,part); go-live carry-forward (entered, not derived)
RmRate         { id; partId; ratePaise; effectiveFrom; supersededAt? }                  // versioned
ProductionRate { id; partId; machineId?; operation?; ratePaise; effectiveFrom; supersededAt? }

Inward   { id; unitId; partId; vendorId?; customerId?; challanNo; challanDate; poNo?;     // customerId = material owner (optional, traceability) — NOT a stock dimension
           dieNo?; batchHeatNo; binNo?; rmRatePaise?; rmWtMg?; finishWtMg?; receivedQty; attachmentName?; remarks?; createdBy; createdAt }
Dispatch { id; inwardId; kind:'billed'|'rejection';                                     // NO unitId — scope via inward
           okQty; mcRejQty; mfQty;                                                      // totalQty = ok+mcRej+mf (DERIVED)
           billNo?; billDate?; dispatchDate?;                                           // billNo '{seq}/{FY}' or 'DC15'
           rateSnapshotPaise?; gstPctSnapshot?;                                         // SNAPSHOT at save; null for rejection
           custInvoiceNo?; custInvoiceDate?; remarks?; createdBy; createdAt }
Invoice  { id; unitId; customerId?; issuerKind:'unit'|'supplier'; issuerId; billNo; fy; seq;  // customerId = consignee, chosen at billing (null on auto-draft)
           invoiceDate; dueDate?; paymentTerms?; custDcNo?; custDcDate?; dispatchIds:Id[]; lifecycle:'draft'|'sent'|'void';
           // snapshot-at-issue (legal immutability): taxKind, assessable, cgst, sgst, igst, roundOff, grand, packing[]
           taxKind?:'igst'|'cgst_sgst'; totals?; packing?; createdBy; createdAt }
Payment  { id; mode:'cash'|'cheque'|'rtgs'|'upi'|'bank'; ref; date; amountPaise;
           allocations:[{ invoiceId:Id; amountPaise }] }                               // one instrument may settle many bills
ScrapBill{ id; unitId; customerId; periodFrom; periodTo; weightGrams; ratePerKgPaise;
           gstPct; tcsPct; scrapInvoiceNo; status }                                     // value/igst/tcs/grand DERIVED
Expense  { id; unitId; vendorId?; category; date; dueDate?; totalPaise;
           instalments:[{ date; amountPaise; mode; ref }] }                             // balance/status DERIVED
RejectionAdvice { id; unitId; customerId; partId; sourceInwardId; rejDcNo; rejDate;
           mrQty; frQty; weightBasis:'finish'|'scrap'; weightPerRingMg; totalWeightGrams } // weight basis = OPEN Q (§9)
Machine  { id; machineNo; description?; unitId; active }
Operation{ id; code; description?; active }                                              // operation master (UC-08 / FR-AT02)
Employee { id; name; empCode; phone?; labourType:'production'|'shift'|'both'; standardShiftRatePaise; unitId; active }
ProductionAttendance { id; unitId; date; shift?; employeeId; machineId; partId; operationId?;
           openingCounter; closingCounter; /*makeQty=close-open DERIVED*/ okQty;
           downtimeCode?; downtimeRemarks?; rateSnapshotPaise; /*earned=ok*rate DERIVED*/ }
ShiftAttendance      { id; unitId; date; shiftNo?; employeeId; fromTime; toTime; /*hours & wage DERIVED*/
           shiftRateSnapshotPaise; otHours?; otRateSnapshotPaise? }
ActivityLogEntry { id; ts; userId; unitId?; command; summary; refIds[] }                // append-only, persisted, FIFO 5000
UndoRecord       { id; ts; command; inversePatches:Patch[] }                            // in-memory, depth 20, NOT persisted
StockSnapshot    { id; unitId; partId; asOfDate; countedQty }                           // optional physical count for I5
```

---

## 5. Selector catalog (all memoized, none stored)

`selectStock(unit,part)` = opening + Σ received − Σ (ok+mcRej+mf) · `selectAvailableForInward(inwardId)` = received − Σ children.totalQty · `selectInwardBalance` → `In-house | Partial | Dispatched` · `selectBillableDispatch(unit,customer)` (unbilled, `okQty>0`, scoped; excludes rejection) · `selectDispatchByBillNo` (groups for the invoice) · `selectInvoiceTotals` (assessable, taxKind via issuer↔customer, cgst/sgst/igst, roundOff, grand) · `selectPacking` (`ceil(Σok/avgQtyPerBox)` + `'5×1050 + 1×750'`) · `selectInvoiceStatus` → draft/sent/paid/partial/overdue/void (paid/overdue derived from payments + `dueDate`) · `selectCustomerLedger` · `selectVendorOutstanding` · `selectExpenseStatus` · `selectScrapTotals` (value→igst18→tcs1→grand) · `selectLowStock` · `selectDashboardKPIs` · `selectReconcile` (I1–I3/I5 → GREEN/RED) · `selectPayroll` (production: `okQty×rate`; shift: `hours/8×shiftRate`).

---

## 6. Transactional command-bus actions

`saveInward` (challan + heat required per FR-IN05; duplicate-challan guard on `(unit, part, challanNo, challanDate)` per FR-IN08) · **`saveOutwardDispatch`** (validate scope + active parts + rejection shape `kind==='rejection' ⇒ okQty===0 && rate==null` + `Σ totalQty ≤ availableForInward`; insert children; snapshot rate+GST; assign/mint Bill No; **create-or-attach the DRAFT invoice grouped by Bill No per FR-BI01**; result `{billNo, lineCount, stockDelta, pendingDelta}` → rich toast + Undo) · **`mintOrAttachBill` / `finalizeInvoice`** (group dispatch lines by Bill No, allocate `seq` atomically from `system.sequences[issuer:fy]`, derive→**snapshot** taxKind+totals+packing on issue) · `recordPayment` (append Payment with `allocations[]`; status/pending derived) · `saveScrapBill` · `saveRejectionAdvice` · `importMioWorkbook` (one transaction, coarse-snapshot undo) · `deactivatePart` (drop from dropdowns, keep history) · `reassignPartToUnit` (new part under new unit, opening 0; old history stays) · `createUser/updateUser/toggleActive/setOverride`. Each is atomic, undoable (except seq counter), observable (structured result), logged.

---

## 7. Phase plan (each task carries a testable acceptance criterion)

> **Demo-able vertical slices.** A working **inward → outward → invoice → payment** chain on real seed data is the spine; build it before breadth.

### P0 — Scaffold & foundations
- Vite + React 18 + TS **strict** (`noUncheckedIndexedAccess`), Tailwind, `@/` alias, ESLint/Prettier, Vitest, all fixed-stack deps. **AC:** `build` + `typecheck` + a trivial `test` pass; Tailwind class renders.
- **`lib/money.ts`** + float-drift suite. **AC:** `toPaise(61301.99999999999)===6130200`; `pctOfPaise(6130200,12)===735624`; `formatINR(15300000)==='1,53,000.00'`; CGST odd-paisa golden test asserts `cgst===ceil(total/2)`; `roundToRupee+roundOffDelta` reconstruct the input; grep gate: no `*100`/`/100` outside money.ts.
- **`types/domain.ts` + `types/rbac.ts` + Zod schemas** for every entity. **AC:** `tsc --strict` clean; Dispatch has `inwardId`, no `unitId`, no stored `totalQty`/line-money; Invoice stores snapshots only at issue; single Module enum exported and imported everywhere.
- **Root store** (`immer + persist 'hew-erp-v1'`, version, `migrate` clearing legacy keys, debounced) + `Normalized<T>` CRUD helpers + scoping choke point. **AC:** 50 rapid sets → 1 write; reload rehydrates data slices, resets session/undo; property test `allIds.length===keys(byId).length`; operator leak test returns `[]` for another unit.
- **Command-bus core + undo + activityLog.** **AC:** validate-failure leaves state deep-equal; denied command throws + zero mutation; success = one `setState`, one log entry, one undo entry; `undoLast()` restores pre-state.
- **Reconcile engine (corrected I1–I3/I5)** built now. **AC:** seeded data GREEN; hand-corrupting one dispatch (over-dispatch a challan / oversell a part) turns it RED with the offending `(unit,customer,part)`/inward listed.
- **Seed + persistence/backup.** Deterministic `seed.ts`: 7 units (u1 = real HEW GSTIN/address/state 27; u2–u7 distinct), 11 real parts (real wts/box + per-part GST 12/18 + HSN), Rolex (24, Gujarat) + 2 customers, 3 vendors, ~15 inwards incl. the golden 8202421273 split + a DC15 rejection + an in-house partial, opening stock, 2 invoices + payments (incl. an `RTGS` ref), 3 scrap bills (TCS), employees/machines/attendance, 4 RBAC users. Settings → **Reset demo data** (typed confirm) + **Export/Import JSON backup** (Zod + migration chain). **AC:** counts match; scrap golden = 29,263,040 paise; reconcile GREEN; backup round-trips deep-equal; tampered import → ZodError toast, store unchanged.

### P1 — Masters
Units, Parts (GST%/HSN/wts-mg/box), Vendors, Customers, Employees, Machines, **Opening-Stock entry**, versioned Rate masters. Full CRUD + RHF/Zod + soft-delete. **AC:** part select auto-derives UOM/wt/GST downstream; GSTIN(15)/stateCode(2) validated; `activeProductionRate(part,machine,date)` returns latest `effectiveFrom≤date`, and adding a rate supersedes the prior in one action; operator cannot open rate-master edit; opening-stock screen writes `StockOpening` and reconcile reflects it.

### P2 — Inward/Outward core *(make-or-break)*
Centerpiece register: TanStack Table v8 expandable **inward→dispatch sub-rows** (grouped by `inwardId`), open-balance pills, filters (part/date/status/unit), saved views, sticky header, sort/resize, virtualization, bulk toolbar. Inward form (duplicate-challan guard). Outward multi-line form (pick parent inward → show available → add N lines ok/mcRej/mf/rate/auto-GST/auto-totals, live total-vs-available). **`saveOutwardDispatch`** transaction + derived live stock + **Undo** + **rich toast**. **AC:** saving challan-8202421273 lines creates 4 children (242 = DC15 rejection, `okQty=0`, unbilled, still consumes 242); over-dispatch blocks with inline overage; editing a part’s GST later does not change a saved dispatch’s `gstPctSnapshot`; `Ctrl+Z` reverts stock exactly; toast reads e.g. “Saved bill 268/24-25 · 3 lines · stock −16,400 · ₹1,53,000 pending”.

### P3 — Excel import wizard *(product, not a script)*
3 steps: drop xlsx (SheetJS, sheet picker) → **column mapper** (signature-scan header, fuzzy auto-detect all 26 cols, dup-`Remarks2` by occurrence, remembered mapping) → grouped **preview/validate** (TanStack sub-rows, error vs warning). One `importMioWorkbook` transaction; idempotency guard; undo reverts the whole batch. **AC:** the real file auto-maps ≥24/26 **including** the required `challanNo`+`receivedQty`; grouping reproduces 8202421273 → 1 inward(28000)+4 children (DC15 flagged rejection); blank-received never makes a 2nd parent; money normalized to paise with a >1-paise sheet-vs-recompute **warning**; dot-dates `09.01.2025`→2025-01-09 and Excel serials both parse; full-file import reconciles to **176,921**; re-drop offers skip-duplicates.

### P4 — Billing
Invoice list (status) + **invoice composer**: groups **billable dispatch by Bill No** (tick-to-include), issuer = unit **or** RM supplier (swap GSTIN/address/bank + tax anchor), IGST-vs-CGST/SGST from issuer↔customer, **mixed-rate** support (rate-wise IGST subtotals), packing auto-calc, atomic per-FY seq, draft→sent→paid/partial/overdue/void lifecycle, bulk actions (mark sent / export / generate PDFs). GST **PDF** (`@react-pdf`) matching HEW layout (letterhead, consignee, spec block incl. HSN, challan-wise lines, packing breakdown, conditional tax rows, round-off, grand, **amount-in-words**, bank) + print stylesheet. `recordPayment` (full/partial; `allocations[]`). **AC:** Rolex invoice shows **IGST 12%** (CGST/SGST suppressed), grand matches the selector to the paise; `formatInvoiceNo` → `254/24-25`; `fyOf(2026-03-30)='25-26'`, `fyOf(2026-05-30)='26-27'`; issuing freezes taxKind+totals (later master edits don’t change it); undo does **not** reuse a seq.

### P5 — Scrap + Expenses + Rejection Advice
Scrap bill (value→IGST18→TCS1→grand, period, register, PDF). Expense tracker (multi-instalment, derived balance/status, vendor-wise outstanding). **Rejection Advice DC** (weight = totalRej × weightPerRing, basis per §9). **AC:** `computeScrap(7117 kg @ 34.5, 18, 1)` = value 24,553,650 / igst 4,419,657 / tcs 289,733 / grand **29,263,040** paise; expense instalments summing to total flip status to settled with no stored status; rejection-advice weight uses the configured basis.

### P6 — Attendance & payroll *(fully specified by SRS §3.6 / FR-AT01–20)*
**Production tab** (Method 1): date, shift, employee, machine, part (Type No), operation, opening/closing counter → **makeQty = close − open**, OK qty, downtime code/remarks, **rate auto-fetched from ProductionRate master by part + machine** → **earned = okQty × rate**. **Shift tab** (Method 2): date, shift no, employee, from/to time → **hours = to − from**, shift rate/8 hr (from Employee), **wage = hours/8 × shiftRate**, plus **OT hours + OT rate**. Masters: Employee (labourType production/shift/both, standardShiftRate, unit), Machine, **Operation**, versioned ProductionRate. Rates are **snapshotted** onto each attendance row at save. **AC:** makeQty = close−open; production earned = ok×rate with the rate auto-fetched & snapshotted; shift wage proportional (hours/8×rate) and OT added; the **FR-AT20 period-wise labour-payment summary** consolidates production + shift earnings employee-wise over a date range; all unit-scoped, persisted, and reconcile to the per-day rows.

### P7 — Reports
Daily inward/outward, challan/heat traceability, billing summary, GST-breakdown revenue, expense/outstanding, **customer-wise** (the SRS gap), attendance (both methods), and the **Reconcile report**. All from selectors over the full store with date+unit+entity filters and xlsx+PDF export. **AC:** customer-wise totals reconcile to register/billing; filters apply via selectors; xlsx money columns are numbers (sum-able), dates `dd-MM-yyyy`; empty range shows EmptyState.

### P8 — RBAC & user management
Role presets + per-user override matrix; route guard + `<Can>`/`useCan` + in-action `assertCan`; selector-layer unit scoping; user CRUD, unit assignment, activate/deactivate (history intact, can’t deactivate last admin); admin-only unit switcher; scoped Cmd+K/global search. **AC:** operator’s Delete is disabled with tooltip and throws if invoked directly; deep-linking `/users` as operator → 403; toggling `inward.delete` on for an operator persists `overrides.add` and flips `can()`; operator’s palette never returns another unit’s entity.

### P9 — Polish & QA
Empty/loading/error sweep, a11y AA (axe), full keyboard map (Cmd+K, `/`, Enter, Esc, Ctrl+Z), responsive-to-tablet (sticky first col, single-col reflow), perf (memoized selectors, virtualized grids, debounced persist, code-split routes + lazy xlsx/pdf), localStorage **quota-exceeded** toast + backup prompt, final reconcile gate (CI fails if any seeded ledger RED), final deterministic seed. **AC:** axe 0 critical across routes; 5k-row register virtualizes (only visible+overscan in DOM); xlsx/pdf chunks load on demand; quota failure is surfaced, not silent.

---

## 8. Risk list & decisions/assumptions (logged — mirrored into status.md)

**Decisions/assumptions baked into this plan** (made per the operating rules; confirm where flagged in §9):
- **Invoice = per Bill No, and the Bill No is our GST invoice number** (one numbering authority); “Rolex Invoice No” is the customer’s ref only.
- **FY for numbering comes from the bill/invoice date**; seq counter `issuerId:FY`; **undo never decrements** the counter (gaps OK, reuse never).
- **taxKind/totals snapshot at issue** (legal immutability) — the single exception to “never store derived”; derivation uses **issuer** state.
- **CGST/SGST odd paisa → CGST.**
- **Stock per `(unit, part)`; grouping key `(unit, challanNo, partId)`; consignee chosen at billing.** ✅ *Confirmed by SRS FR-ST02 / FR-RM03a.*
- **MR (machine rej) + MF (RM-fault/residue) both consume stock; neither is billed.** ✅ *Confirmed by SRS FR-OUT02 / FR-OUT05* (the 176,921 reconciliation holds).
- **GST% is a per-part master attribute** (12% Rolex / 18% others). ✅ *Confirmed by UC-03 / BRD.*
- **A DRAFT invoice is auto-created/attached on dispatch save** (grouped by Bill No); the Billing module finalizes it (consignee, issuer, PDF, number). ✅ *Confirmed by SRS FR-BI01 / UC-05/06.*
- **Rejection consumption is not reversible in v1** (rework-after-rejection deferred).
- **TCS = flat 1% on (value+GST)** per the sample; `tcsPct`/base kept configurable.
- **Weights stored integer mg/grams; rates 2-dp (paise).**
- **Mock auth** (pick a seeded user; password ignored) — frontend-only, not real security.
- **Credit notes & partial-quantity billing are out of scope for v1** (whole-line billing); noted as known limitations.
- **Scope beyond the formal SRS/BRD (flag for sign-off):** Scrap billing + TCS and the Rejection-Advice DC live only in the real Excel + the build prompt (the SRS has *no* scrap-billing or rejection-advice module). **Invoice email dispatch** (a BRD deliverable) needs a backend — in a frontend-only app it degrades to PDF download / `mailto:`.
- **Roles:** the docs define **two** formal classes (Admin/Manager, Operator); our 3-role RBAC (admin ⊇ manager ⊇ operator) + permission matrix is a superset that maps cleanly onto them.

**Top risks (with mitigations):**
1. **Reconcile must be the corrected I1–I3 form** — the naive identity catches nothing. *Mitigation:* the per-inward over-dispatch + per-part oversold + referential checks above; golden fixtures.
2. **Float re-entry after the boundary** (stored line money, fractional scrap weight). *Mitigation:* store only snapshots needed for immutability; integer grams for scrap; grep/lint gate; per-bill recompute cross-check.
3. **Sequence integrity under undo / supplier issuers.** *Mitigation:* allocate atomically, never roll back; counter keyed by `issuerId` so supplier-issued invoices get their own statutory series.
4. **Unit-scope leak via Dispatch** (no own `unitId`). *Mitigation:* the single `scopedDispatches` choke point + a dedicated leak test seeding another unit.
5. **localStorage ~5 MB quota** (7 units + activityLog + undo). *Mitigation:* cap log/undo, exclude derived/undo from persist, quota-exceeded toast + backup prompt (P9, not silent).
6. **Importer is the spine** (blank-received continuation, leading-rejection edge, dup-Remarks2, dot/serial dates). *Mitigation:* one parser, golden fixtures incl. a leading-rejection case, signature-scan header.
7. **Client-side-only RBAC** (localStorage edit = admin). *Mitigation:* documented accepted constraint; gate at selector+route+action for honest-user correctness.

---

## 9. Blocking questions for the client (answers needed before P3/P4 lock; P0–P2 proceed on the assumptions above)

> **The SRS + BRD resolved 3 of the original 8** — now closed (logged in §8): **stock granularity** = `(unit, part)` (FR-ST02/RM03a); **MF consumes stock & isn’t billed** (FR-OUT02/05); **GST% is per-part** (UC-03). The remaining open items:

1. **FY at the Mar/Apr boundary:** When a challan is dispatched in late March but billed in early April, does the `{FY}` label + sequence come from the **bill/invoice date** (assumed) or the dispatch date?
2. **Sequence scope & supplier issuers:** Is the per-FY sequence shared across **all customers of a unit** (assumed), or per customer? And for an **RM-supplier-issued** invoice (FR-BI03), does the statutory sequence belong to the **unit** or the **supplier’s GSTIN**?
3. **Scrap TCS** *(scrap billing is added scope beyond the SRS):* Flat **1% on every** scrap bill (assumed, base = value+GST), or threshold-based (Sec 206C, PAN/turnover-dependent)?
4. **Rework after rejection:** Can rejected (MR/MF) quantity be **reworked and re-dispatched** later (⇒ consumption must be reversible — deferred in v1), and is the **Rejection-Advice weight** computed with **finishWt** (assumed) or scrapWt? *(Rejection Advice is added scope beyond the SRS.)*
5. **Payment allocation:** The SRS models payment **per invoice** (FR-BI10); the real `RTGS` lump-sums suggest one instrument may settle **several bills**. We use an `allocations[]` superset — confirm whether one payment should settle multiple bills, and whether it can span units.
6. **Invoice email dispatch** (a BRD deliverable) needs a server to send mail. In a frontend-only build this becomes **PDF download / `mailto:`** — confirm that’s acceptable, or that emailing is a later backend phase.

*(Non-blocking, deferred to v1.1 unless you say otherwise: credit notes, partial-quantity billing across two invoices, scrap-weight auto-derivation from `scrapWt × rejectedQty`.)*

---

**Next step:** on your approval of this plan I begin **P0** (scaffold, money module, store, command-bus, reconcile engine, seed/backup) and keep [status.md](status.md) updated after every chunk.
