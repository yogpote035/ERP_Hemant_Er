# Lovable Mock — UI Spec (route-by-route)

> **Source:** the deployed client mock at **https://industrial-forge-dash.lovable.app/**
> Captured page-by-page. Each section has the **live URL** — click to view the real screen.
>
> **About the "Form fields" blocks:** the mock's create/edit forms are **modals behind the
> CTAs** and a static fetch cannot open them. Each form-field list below is therefore
> **reconstructed** from (a) the page's own list-table columns — an "Add X" form populates
> exactly the columns its table shows — and (b) the implemented form in the code
> ([current-frontend-forms.md](./current-frontend-forms.md)). Fields only the code confirms
> are tagged **[code]**. **Verify against the live modal** before building to it.
>
> **About the data tables:** every table below shows the mock's **exact columns and its
> hard-coded demo row values** (verbatim). These numbers are sample/seed data, not live.

**Product chrome (every authenticated page):**
- **Brand:** HEMANT ENGINEERING WORKS · "Job Work & Billing Automation" · ISO 9001:2015 · GST Compliant
- **Sidebar (10 items):** Dashboard · Raw Material Master · Vendor Management · Material Inward · Material Outward · Inventory Stock · Billing & Invoice · Expense Tracker · Reports · Settings + **Toggle Sidebar**
- **Topbar:** breadcrumb `Operations / Dashboard` · settings icon · user chip **5HE · Hemant Patel · Plant Admin**
- **Footer:** © 2026 Hemant Engineering Works · Pune, MH · **ERP v4.2** · GSTIN **27AABCH1234E1Z5**

### Route map

| # | Module | Route |
|---|--------|-------|
| 0 | Login / Sign-in | `/` |
| 1 | Dashboard | `/dashboard` |
| 2 | Raw Material Master | `/materials` |
| 3 | Vendor Management | `/vendors` |
| 4 | Material Inward | `/inward` |
| 5 | Material Outward / Dispatch | `/outward` |
| 6 | Inventory Stock | `/inventory` |
| 7 | Billing & GST Invoices | `/billing` |
| 8 | Expense & Supplier Payments | `/expenses` |
| 9 | Reports & Analytics | `/reports` |
| 10 | Settings | `/settings` |

---

## 0. Login / Sign-in
- **Live URL:** https://industrial-forge-dash.lovable.app/
- **Page title:** "The complete ERP for precision manufacturing"

### What it shows
- **Hero stats:** 12+ yrs on the shop floor · 47 active vendors · ₹14.2 Cr annual throughput
- **Sign-in card** with the auth form
- Trust copy: "Secured by 256-bit TLS · Audit logged" · demo mode accepts test credentials

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Sign in to ERP | form primary | authenticates → dashboard |
| Forgot? | inline (password) | password reset |
| Skip to dashboard | link | bypasses auth → `/dashboard` (demo) |

### Form fields (visible on page — not a modal)
| Label | type | req | notes |
|-------|------|-----|-------|
| Username / email | text | ✓ | |
| Password | password | ✓ | with "Forgot?" link |
| Remember me for 30 days | checkbox | – | |

### Notes
Footer: © 2026 Hemant Engineering Works · Pune, MH. "Edit with Lovable" dev credit.

---

## 1. Dashboard
- **Live URL:** https://industrial-forge-dash.lovable.app/dashboard
- **Page title:** Dashboard (breadcrumb `Operations / Dashboard`)

### What it shows

**8 KPI cards** (label · value · sub-label):
| KPI | Value | Sub-label |
|-----|-------|-----------|
| Total Inward (MT) | 1284 | +12.4% vs last month |
| Total Dispatch (MT) | 1156 | +8.1% vs last month |
| Live Stock (MT) | 428 | -3.2% vs last month |
| Pending Payments | ₹18.4L | +4.6% vs last month |
| Revenue (MTD) | ₹1.24Cr | +22.8% vs last month |
| Invoices Issued | 248 | +14 vs last month |
| Active Vendors | 47 | +3 vs last month |
| Monthly Production | 92,450 pcs | +9.7% vs last month |

**Charts:** Revenue vs Expenses · Dispatch by Customer · Stock Movement (this week)

**Table — Pending Payments**
| Supplier | Part | Amount | Status |
|----------|------|--------|--------|
| Tata Steel Ltd | MS Round Bar 25mm | ₹63,200 | Partial |
| Mahindra Forgings | EN-19 Forged Blank | ₹1,68,480 | Pending |
| Bharat Heavy Forge | Cast Iron Housing | ₹40,200 | Partial |
| Kalyani Carpenter Steel | Tool Steel Round | ₹78,400 | Pending |

**Table — Recent Inward Entries**
| Challan | Supplier | Part | Qty |
|---------|----------|------|-----|
| CH-2026-1184 | Jindal Steel & Power Ltd | HEW-EN-008 | 1,850 |
| CH-2026-1183 | Tata Steel Ltd | HEW-MS-001 | 2,400 |
| CH-2026-1182 | Mahindra Forgings | HEW-EN-019 | 540 |
| CH-2026-1181 | Sundaram Metals Pvt Ltd | HEW-SS-304 | 980 |
| CH-2026-1180 | Bharat Heavy Forge | HEW-CI-077 | 220 |

**Table — Latest Invoices**
| Invoice No | Customer | Amount | Status |
|------------|----------|--------|--------|
| HEW/26-27/0184 | Bajaj Auto Ltd | ₹2,09,664 | Pending |
| HEW/26-27/0183 | Tata Motors Ltd | ₹2,90,304 | Pending |
| HEW/26-27/0182 | Mahindra & Mahindra | ₹1,57,907 | Paid |
| HEW/26-27/0181 | Bosch India Ltd | ₹2,19,008 | Partial |
| HEW/26-27/0180 | Endurance Technologies | ₹1,36,448 | Partial |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Export | header | export dashboard data |
| New Entry | header | quick-entry form (see below) |
| View all | on Recent Inward + Latest Invoices tables | navigates to the full register |

### Form fields — "New Entry" (quick create)
*Ambiguous in the mock — a generic shortcut. The code has no single "New Entry"; it splits into
Inward / Dispatch / Invoice. Treat as a fast path to the **Material Inward** form (§4).*

### Filters / tabs
None.

---

## 2. Raw Material Master
- **Live URL:** https://industrial-forge-dash.lovable.app/materials
- **Sub-title:** "Manage part numbers, HSN codes and GST rates across the catalogue"

### What it shows
**Table — Raw Materials** (columns: Part Number · Description · UOM · HSN Code · GST % · Type · Actions)
| Part Number | Description | UOM | HSN Code | GST % | Type |
|-------------|-------------|-----|----------|-------|------|
| HEW-MS-001 | MS Round Bar 25mm | KG | 72142090 | 18% | Raw |
| HEW-EN-008 | EN-8 Round Bar 40mm | KG | 72280030 | 18% | Raw |
| HEW-EN-019 | EN-19 Forged Blank | PCS | 73269099 | 18% | Semi-Finished |
| HEW-SS-304 | SS-304 Sheet 2mm | KG | 72193590 | 18% | Raw |
| HEW-AL-T6 | Aluminium 6061-T6 Bar | KG | 76042910 | 18% | Raw |
| HEW-FG-112 | CNC Machined Hub Flange | PCS | 84839000 | 18% | Finished |
| HEW-FG-205 | Forged Yoke Assembly | PCS | 87089900 | 28% | Finished |
| HEW-CI-077 | Cast Iron Housing | PCS | 84833000 | 18% | Semi-Finished |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Add Material | header | create / edit form (see below) |
| Export | header | export catalogue |
| (row) Actions | row | edit / delete row |

### Form fields — Add / Edit Material
*Derived from list columns; **[code]** = also in the implemented Part form.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Part Number | text | ✓ | unique |
| Description | textarea | – | |
| UOM | text/select | ✓ | NOS / KG / PCS |
| HSN Code | text | ✓ | |
| GST % | select | ✓ | 5 / 12 / 18 / 28 |
| Type | select | ✓ | Raw / Semi-Finished / Finished |
| Material code | text | ✓ | **[code]** |
| Unit | select | ✓ | **[code]** owning unit |
| Finish weight (g) | number | ✓ | **[code]** |
| Scrap weight (g) | number | ✓ | **[code]** |
| Avg qty / box | number | ✓ | **[code]** |
| Category / Edition no. | text | – | **[code]** |

### Filters / tabs
- "All Types" dropdown (filter by Raw / Semi-Finished / Finished)

---

## 3. Vendor Management
- **Live URL:** https://industrial-forge-dash.lovable.app/vendors
- **Sub-title:** "Suppliers, GST profiles, banking details and outstanding ledgers"

### What it shows
**4 stat cards (this quarter):** Active Vendors **47** · On Hold **3** · GST Verified **44** · New (30d) **5**

**Table — Vendors** (columns: Code · Vendor · GSTIN · Location · Contact · Status)
| Code | Vendor | GSTIN | Location | Contact | Status |
|------|--------|-------|----------|---------|--------|
| VND-001 | Jindal Steel & Power Ltd | 27AAACJ4323N1ZP | Mumbai, Maharashtra | +91 98200 11122 | Active |
| VND-002 | Tata Steel Ltd | 27AAACT2727Q1ZW | Jamshedpur, Jharkhand | +91 98300 44455 | Active |
| VND-003 | Mahindra Forgings | 27AABCM2034E1Z3 | Pune, Maharashtra | +91 98220 77788 | Active |
| VND-004 | Bharat Heavy Forge | 27AAFCB8821K1ZN | Aurangabad, Maharashtra | +91 99201 22334 | Hold |
| VND-005 | Sundaram Metals Pvt Ltd | 33AAGCS1234L1Z8 | Chennai, Tamil Nadu | +91 98400 55677 | Active |
| VND-006 | Kalyani Carpenter Steel | 27AABCK0214H1Z1 | Pune, Maharashtra | +91 98223 99887 | Active |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Add Vendor | header | create / edit form (see below) |

### Form fields — Add / Edit Vendor
*Derived from list columns + stat cards; **[code]** = also in the implemented Vendor form.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Vendor name | text | ✓ | |
| Code | text | ✓ | unique (VND-00n) |
| GSTIN | text | – | enables the "GST Verified" stat |
| Location (City / State) | text | – | shown as "Location" |
| Contact person | text | – | |
| Phone | text | – | shown as "Contact" |
| Status | select | – | Active / Hold (drives "On Hold" stat) |
| Type | select | ✓ | **[code]** rm / service |
| Email | text | – | **[code]** |
| PAN | text | – | **[code]** |
| State code | text | – | **[code]** |
| Pincode | text | – | **[code]** |
| Address | textarea | – | **[code]** |
| Bank name / Account no. / IFSC | text | – | **[code]** |
| Remarks | textarea | – | **[code]** |

### Filters / tabs
None visible.

### Notes
Status pills: **Active**, **Hold**.

---

## 4. Material Inward
- **Live URL:** https://industrial-forge-dash.lovable.app/inward
- **Sub-title:** "Record challan-wise material receipt with heat number and supplier"

### What it shows
**Table — Material Inward** (columns: Inward Date · Challan # · PO # · Supplier · Part · Heat # · Bin · Qty · Rate · Value)
| Inward Date | Challan # | PO # | Supplier | Part | Heat # | Bin | Qty | Rate | Value |
|-------------|-----------|------|----------|------|--------|-----|-----|------|-------|
| 18-05-2026 | CH-2026-1184 | PO-HEW-0421 | Jindal Steel & Power Ltd | HEW-EN-008 | H-J24-8821 | B-04 | 1,850 | ₹92 | ₹1,70,200 |
| 17-05-2026 | CH-2026-1183 | PO-HEW-0420 | Tata Steel Ltd | HEW-MS-001 | H-T26-4412 | B-02 | 2,400 | ₹68 | ₹1,63,200 |
| 16-05-2026 | CH-2026-1182 | PO-HEW-0419 | Mahindra Forgings | HEW-EN-019 | H-MF-9931 | B-09 | 540 | ₹312 | ₹1,68,480 |
| 15-05-2026 | CH-2026-1181 | PO-HEW-0418 | Sundaram Metals Pvt Ltd | HEW-SS-304 | H-S26-7741 | B-05 | 980 | ₹220 | ₹2,15,600 |
| 14-05-2026 | CH-2026-1180 | PO-HEW-0417 | Bharat Heavy Forge | HEW-CI-077 | H-BHF-2210 | B-11 | 220 | ₹410 | ₹90,200 |

*(Value = Qty × Rate.)*

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| New Inward | header | create / edit form (see below) |
| Import | header | bulk import flow |
| Export | header | export register |

### Form fields — New / Edit Inward
*Derived from list columns; **[code]** = also in the implemented Inward form.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Inward Date | date | ✓ | DD-MM-YYYY, default today |
| Challan # | text | ✓ | |
| PO # | text | – | |
| Supplier | select | – | vendor |
| Part | select | ✓ | |
| Heat # | text | ✓ | batch / heat no. |
| Bin | text | – | storage bin |
| Qty | number | ✓ | received qty (int > 0) |
| Rate (₹) | number | – | per unit |
| Value | computed | — | = Qty × Rate |
| Unit | select | ✓ | **[code]** owning unit |
| Customer / owner | select | – | **[code]** |
| Die no. | text | – | **[code]** |
| Remarks | textarea | – | **[code]** |

### Filters / tabs
None visible.

---

## 5. Material Outward / Dispatch
- **Live URL:** https://industrial-forge-dash.lovable.app/outward
- **Sub-title:** "Challan-cum-invoice dispatch with auto-GST, packing details & stock sync"

### What it shows
**Table — Material Outward / Dispatch** (columns: Invoice # · Dispatch Date · Ref Challan · Customer · Part · OK Qty · Faulty · Rate · GST · Total)
| Invoice # | Dispatch Date | Ref Challan | Customer | Part | OK Qty | Faulty | Rate | GST | Total |
|-----------|---------------|-------------|----------|------|--------|--------|------|-----|-------|
| HEW/26-27/0184 | 18-05-2026 | CH-2026-1180 | Bajaj Auto Ltd | HEW-FG-112 | 1,200 | 8 | ₹148 | 18% | ₹2,09,664 |
| HEW/26-27/0183 | 17-05-2026 | CH-2026-1179 | Tata Motors Ltd | HEW-FG-205 | 540 | 4 | ₹420 | 28% | ₹2,90,304 |
| HEW/26-27/0182 | 16-05-2026 | CH-2026-1178 | Mahindra & Mahindra | HEW-FG-112 | 880 | 2 | ₹152 | 18% | ₹1,57,907 |
| HEW/26-27/0181 | 15-05-2026 | CH-2026-1177 | Bosch India Ltd | HEW-CI-077 | 320 | 0 | ₹580 | 18% | ₹2,19,008 |
| HEW/26-27/0180 | 14-05-2026 | CH-2026-1176 | Endurance Technologies | HEW-FG-205 | 260 | 1 | ₹410 | 28% | ₹1,36,448 |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| New Dispatch | header | create / edit form (see below) |
| Export | header | export register |

### Form fields — New / Edit Dispatch
*Derived from list columns; **[code]** = also in the implemented Dispatch form.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Ref Challan | select | ✓ | source inward challan |
| Dispatch Date | date | ✓ | |
| Customer | select | ✓ | |
| Part | select | ✓ | (from challan) |
| OK Qty | number | – | |
| Faulty | number | – | = machine-reject + RM-fault **[code]** |
| Rate | number | ✓ if billed | per piece |
| Invoice # / Bill no. | text | ✓ if billed | |
| Type | select | ✓ | **[code]** billed / rejection |
| Customer invoice no. | text | – | **[code]** |
| GST | computed | — | from the part's GST % |
| Total | computed | — | = OK Qty × Rate + GST |

### Filters / tabs
- "All Customers" dropdown (filter by customer)

---

## 6. Inventory Stock
- **Live URL:** https://industrial-forge-dash.lovable.app/inventory

### What it shows
**4 KPI cards:** Total Available **4,479 pcs / 14 SKUs** · Heats Tracked **26 active this month** · Scrap Generated **106 pcs (1.4% of throughput)** · Low Stock Alerts **3 below reorder point**

**Table — Inventory Stock** (columns: Material · Heat # · Opening · Inward · Outward · Scrap · Available · Utilisation %)
| Material | Heat # | Opening | Inward | Outward | Scrap | Available | Utilisation |
|----------|--------|---------|--------|---------|-------|-----------|-------------|
| EN-8 Round Bar 40mm | H-J24-8821 | 1,200 | +1,850 | -1,620 | 35 | 1,395 | 54% |
| MS Round Bar 25mm | H-T26-4412 | 800 | +2,400 | -2,100 | 22 | 1,078 | 66% |
| EN-19 Forged Blank | H-MF-9931 | 220 | +540 | -460 | 8 | 292 | 62% |
| SS-304 Sheet 2mm | H-S26-7741 | 460 | +980 | -720 | 12 | 708 | 51% |
| Cast Iron Housing | H-BHF-2210 | 90 | +220 | -165 | 5 | 140 | 55% |
| CNC Machined Hub Flange | H-FG-3320 | 340 | +1,180 | -1,020 | 18 | 482 | 68% |
| Aluminium 6061-T6 Bar | H-AL-1109 | 220 | +480 | -310 | 6 | 384 | 45% |

**Chart:** Available Stock by Material (bar) — EN-8, MS Round Bar, EN-19, SS-304, Cast Iron, CNC Machined, Aluminium

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Excel | header / export | export to Excel |
| PDF | header / export | export to PDF |

### Form fields
**None** — this is a **read-only** computed view (export only). The code's equivalent Stock page
likewise has no create form (§4 of the forms doc).

### Filters / tabs
None visible.

---

## 7. Billing & GST Invoices
- **Live URL:** https://industrial-forge-dash.lovable.app/billing
- **Sub-title:** "Auto-generated tax invoices with HSN, heat number & challan traceability"

### What it shows
**4 KPI cards (MTD):** Invoices **248 (+14 this week)** · Taxable Value **₹1.05 Cr (+22% MoM)** · GST Collected **₹18.9 L (CGST+SGST+IGST)** · Pending Collection **₹14.2 L (from 18 invoices)**

**Table — Invoices** (columns: Invoice # · Date · Customer · Taxable · GST · Grand Total · Status · Actions)
| Invoice # | Date | Customer | Taxable | GST | Grand Total | Status | Actions |
|-----------|------|----------|---------|-----|-------------|--------|---------|
| HEW/26-27/0184 | 18-05-2026 | Bajaj Auto Ltd | ₹1,77,600 | ₹31,968 | ₹2,09,568 | Issued | Preview |
| HEW/26-27/0183 | 17-05-2026 | Tata Motors Ltd | ₹2,26,800 | ₹63,504 | ₹2,90,304 | Issued | Preview |
| HEW/26-27/0182 | 16-05-2026 | Mahindra & Mahindra | ₹1,33,760 | ₹24,076.8 | ₹1,57,836.8 | Issued | Preview |
| HEW/26-27/0181 | 15-05-2026 | Bosch India Ltd | ₹1,85,600 | ₹33,408 | ₹2,19,008 | Issued | Preview |
| HEW/26-27/0180 | 14-05-2026 | Endurance Technologies | ₹1,06,600 | ₹29,848 | ₹1,36,448 | Issued | Preview |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| New Invoice | header | create / edit form (see below) |
| GSTR-1 Export | header | export GSTR-1 |
| Preview | row action | invoice preview / PDF |

### Form fields — New / Edit Invoice
*Derived from list columns; **[code]** = also in the implemented Finalize-invoice form.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Customer | select | ✓ | consignee (bill to) |
| Invoice Date | date | – | |
| Line items | table | ✓ | billed dispatches: Part · Challan · Qty · Rate |
| Issued by | select | – | **[code]** unit / supplier |
| RM supplier | select | ✓ if issuer=supplier | **[code]** |
| Taxable | computed | — | Σ line amounts |
| GST | computed | — | CGST+SGST (intra-state) or IGST (inter-state) |
| Round off | computed | — | **[code]** to nearest ₹ |
| Grand Total | computed | — | taxable + GST ± round-off |

### Filters / tabs
None visible.

### Notes
Status pill: **Issued**.

---

## 8. Expense & Supplier Payments
- **Live URL:** https://industrial-forge-dash.lovable.app/expenses
- **Sub-title:** "Track outstanding balances, payment schedules and monthly expense trends"

### What it shows
**4 KPI cards:** Total Paid (MTD) **₹5,35,800** · Outstanding Dues **₹3,50,280** · Overdue >30d **₹2.4 L** · Avg. Payment Cycle **22 days**

**Charts:** Monthly Expense Trend (Apr–Nov, 0L–10L) · Payment Velocity (Apr–Nov)

**Table — Expenses** (columns: Date · Supplier · Item · Total · Paid · Balance · Pay Date · Mode · Status)
| Date | Supplier | Item | Total | Paid | Balance | Pay Date | Mode | Status |
|------|----------|------|-------|------|---------|----------|------|--------|
| 18-05-2026 | Jindal Steel & Power Ltd | EN-8 Round Bar 40mm | ₹1,70,200 | ₹1,70,200 | ₹0 | 18-05-2026 | RTGS | Paid |
| 17-05-2026 | Tata Steel Ltd | MS Round Bar 25mm | ₹1,63,200 | ₹1,00,000 | ₹63,200 | 17-05-2026 | NEFT | Partial |
| 16-05-2026 | Mahindra Forgings | EN-19 Forged Blank | ₹1,68,480 | ₹0 | ₹1,68,480 | - | - | Pending |
| 15-05-2026 | Sundaram Metals Pvt Ltd | SS-304 Sheet 2mm | ₹2,15,600 | ₹2,15,600 | ₹0 | 15-05-2026 | RTGS | Paid |
| 14-05-2026 | Bharat Heavy Forge | Cast Iron Housing | ₹90,200 | ₹50,000 | ₹40,200 | 14-05-2026 | Cheque | Partial |
| 13-05-2026 | Kalyani Carpenter Steel | Tool Steel Round | ₹78,400 | ₹0 | ₹78,400 | - | - | Pending |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Record Expense | header | create / edit form (see below) |
| Export | header | export ledger |

### Form fields — Record / Edit Expense
*Derived from list columns; **[code]** = also in the implemented Expense + Pay forms.*
| Label | type | req | options/notes |
|-------|------|-----|---------------|
| Date | date | ✓ | |
| Supplier | select | – | vendor |
| Item | text | ✓ | category (shown as "Item") |
| Total | number (₹) | ✓ | total payable |
| Paid | number (₹) | – | via the Pay action |
| Pay Date | date | – | |
| Mode | select | – | RTGS / NEFT / Cheque / UPI / Cash |
| Balance | computed | — | total − paid |
| Status | computed | — | Paid / Partial / Pending (+ Overdue **[code]**) |
| Unit | select | ✓ | **[code]** |
| Due date | date | – | **[code]** drives overdue status |

> In the code, Paid / Pay Date / Mode are entered in a **separate "Pay expense" modal**
> (amount · mode · ref · date) that appends instalments — not inline on the expense row.

### Filters / tabs
None visible.

### Notes
Status pills: **Paid**, **Partial**, **Pending**.

---

## 9. Reports & Analytics
- **Live URL:** https://industrial-forge-dash.lovable.app/reports
- **Sub-title:** "Operational, financial and statutory reports — ready to download"

### What it shows
**Charts:** Revenue Trend (Apr–Nov, 0L–16L) · Material Movement (Mon–Sun, 0–180)

**Reports grid (8)** — each card exports Excel + PDF:
| Report | ID | Status | Exports |
|--------|----|--------|---------|
| Daily Inward Report | RPT-001 | Updated Today | Excel, PDF |
| Material Outward Register | RPT-002 | Updated Today | Excel, PDF |
| Live Inventory Snapshot | RPT-003 | Updated 1h ago | Excel, PDF |
| GST Sales Register (GSTR-1) | RPT-004 | Updated Today | Excel, PDF |
| Vendor Outstanding Statement | RPT-005 | Updated Today | Excel, PDF |
| Monthly Revenue Report | RPT-006 | Updated 1d ago | Excel, PDF |
| Heat-wise Traceability | RPT-007 | Updated Today | Excel, PDF |
| Job Work Production Summary | RPT-008 | Updated Today | Excel, PDF |

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Bulk Export | header | export all reports |
| Excel / PDF | per report card | export that report |

### Form fields
**None** — reports are **read-only** (export only). In the code each report card opens a drawer
with Excel / CSV / Print exports + an optional **From / To** date filter (§14 of the forms doc).

### Filters / tabs
None visible (per-report export only).

---

## 10. Settings
- **Live URL:** https://industrial-forge-dash.lovable.app/settings
- **Sub-title:** "Company profile, invoicing, users, roles and backups"

### What it shows
- **5 tabs:** Company · Invoicing · Users · Roles · Backup
- **Company tab** is active; the others exist but were not active in the snapshot.

### CTAs / buttons
| Label | Placement | Opens |
|-------|-----------|-------|
| Save Changes | top of form | persists company profile |

### Form fields — per tab
**Company** (visible on page — *"Used on invoices, e-way bills and letterheads"*):
| Label | type | req |
|-------|------|-----|
| Legal Name | text | ✓ |
| Trade Name | text | – |
| GSTIN | text | ✓ |
| PAN | text | – |
| CIN | text | – |
| MSME / UDYAM | text | – |
| Address | textarea | – |
| City | text | – |
| State | text/select | – |
| Phone | text | – |
| Email | text | – |

**Invoicing / Users / Roles / Backup** — *tabs present but not active in the snapshot; fields
below are inferred from the tab names and the code's equivalents:*
- **Invoicing:** invoice format / prefix, sequence padding, payment terms, bank details, T&C, logo
  (code: the Unit master's `invoiceFormat` + `seqPad`).
- **Users:** user list + add (Name · Email · Role · Assigned units) — code `/users`.
- **Roles:** role list + permission matrix (15 modules × 6 actions) — code `/users`.
- **Backup:** export / restore the full data store (not yet built in code).

> **Note for the code:** the current frontend has **no Settings page** — Company/Invoicing config
> lives in the **Unit master**, which lacks Trade Name, PAN, CIN, MSME/UDYAM, Phone, Email.
> See the gap analysis **P1** item.

### Filters / tabs
- Tabs: Company · Invoicing · Users · Roles · Backup

---

## Capture caveats
- The data tables above show the mock's **exact columns + its hard-coded demo rows** (verbatim);
  these values are sample/seed data, not live.
- **Create/edit modals were not opened** (static fetch) — the **Form fields** blocks are
  reconstructed from each page's list columns + the implemented code form; **[code]**-tagged rows
  are confirmed only by the code. Verify against the live modal.
- Minor mock inconsistency: the same invoice (e.g. HEW/26-27/0182) shows slightly different grand
  totals on the Dashboard vs Billing vs Outward tables — the demo data isn't fully cross-reconciled.
