# Client-shared formats — deep analysis

> **Source:** `Inventory_Management_Client_Formats.pdf` (5 pages) shared by the client (HEMANT
> ENGINEERING WORKS). These are the **real** production formats — the actual GST tax invoice,
> the Inward & Outward form field lists, the "auto-fetch" mapping for invoices, and the two
> attendance formats. This is the authoritative field spec; cross-check against
> [current-frontend-forms.md](./current-frontend-forms.md) and [lovable-mock-ui-spec.md](./lovable-mock-ui-spec.md).

---

## Page 1 — GST Tax Invoice (the real invoice layout)

**Statutory header:** "GST Tax Invoice (U/s 31 of CGST & SGST Act R.W Section 20 of IGST Act)".

### Supplier block (left header)
| Field | Value on sample |
|-------|-----------------|
| Company's Name | HEMANT ENGINEERING WORKS (**UNIT-1**) |
| Address (Head Office & Works) | Gat No.246/5, Barge Wasti, Alandi Road, Village-Chimbli, Taluka-Khed, District-Pune |
| GSTIN/UIN | 27AAKPV1798A1ZD |
| State / State Code / Pin | Maharashtra / 27 / 412 105 |
| PAN No | AAKPV1798A |
| **MSME No** | UDYAM-MH-26-0069570 |
| Email / Website | hew.unit1@gmail.com / www.grouphew.com |

### Invoice meta (right header)
| Field | Value | Has a Date? |
|-------|-------|-------------|
| HEW Invoice No | HEW/25-26/443 | 24-03-2026 |
| **YEN PO / Jobwork Order No** | YEN/BGM/PO/006/24-25 | 30-04-2024 |
| **Yenkays (customer) Tax Invoice No** | GST/25-26/ | (blank) |
| **Motor Vehicle No** | MH14GD8659 | (blank) |
| Terms of Payment / Due Date | 45 Days Credit / 08-05-2026 | |
| **Dispatched Through** / **Destination** | Hemant Own Vehicle / Chinchwad, Pune | |
| Remark | (blank) | |

### Receiver — "Details of Receiver (Bill To)"
Company Name (YENKAYS ENGINEERING PRIVATE LIMITED) · Address (Plot No.80/A, KIADB, Industrial
Area, Honaga, Belgavi) · Email / Phone · State / State Code / Pin (Karnataka / 29 / 591 113) ·
GSTIN/UIN (29AAACY9100E1ZF) · PAN No (AAACY9100E).

### Line-item table
Columns: **Sl.No · Description & Specification of Goods · Customer D.C No · Customer D.C Date ·
HSN/SAC · Qty (Nos) · Rate (Pcs) · Amount ₹**

The **"Description & Specification of Goods"** cell is itself a *structured block* of part-identity fields:
- Part Type (TRB Inner Ring) · **Part No** (IM-BT1-1798) · **Die No** (1275-IR) · **Drg Edt No** (1/19 10)
- **IRC / Bin No** (6727 / B312) · **Heat No** (4197Q,4193Q) · **RM Supplier** (KFIL STEEL)
- **Finish Weight** (0.330 GM) · **Packing Mode** (GSP-2)

**One part line aggregates many dispatch challans.** On the sample, the single part row carries
**two** Customer D.C entries:
| Customer D.C No | D.C Date | Qty (Nos) | Rate | Amount |
|---|---|---|---|---|
| 25-26/2223 | 12-03-2026 | 2,200.00 | ₹4.25 | ₹9,350.00 |
| 25-26/22265 | 13-03-2026 | 3,800.00 | ₹4.25 | ₹16,150.00 |
| | **Total** | **6,000.00** | | |

HSN/SAC = 9988 (job-work / machining service).

### Packing details
`5 GSP-2 × 1050 = 5250` · `1 GSP-2 × 750 = 750` · **TOTAL 6 GSP2 = 6000** (box-size breakdown that sums to total qty).

### Notes ("Note Machining Charges of Your Forged Rings")
1. All material in oiled condition · 2. All material packed in GSP wooden boxes · 3. Sample Inspection & MPI Report attached.

### Tax & totals
| | |
|---|---|
| Assessable Value | ₹25,500.00 |
| CGST @ 9.00% | ₹0.00 |
| SGST @ 9.00% | ₹0.00 |
| **IGST @ 18.00%** | ₹4,590.00 |
| Rounding off (+/-) | ₹0.00 |
| **Grand Total** | **₹30,090.00** |

Inter-state (MH→Karnataka) ⇒ IGST 18% applies (CGST/SGST zero). 25,500 × 18% = 4,590; words: **"Rs Thirty Thousand Ninety Only"**.

### Footer
GST self-certification paragraph · **Terms & Conditions** (object within 3 days; 12% p.a. interest if
overdue; Pune jurisdiction) · **Our Bank Details** (A/C Name Hemant Engg Works · A/C 10038375621 · IFSC
IDFB0041356 · IDFC First Bank · Pimpri, Pune · Overdraft Account) · "For HEMANT ENGINEERING WORKS
(UNIT-1)" + Authorised Signatory.

---

## Page 2 — INWARD FORM FIELDS
Single-row field header (the data-entry grid columns):

`Sr.No. · Challan No. · Challan.Date · Part No. · PO No. · Die No · Batch/Heat No. · Bin No. ·
RM Supplier · RM Rate/pc · RM Wt/pc · Finish Wt/pc · Received QTY`

---

## Page 3 — OUTWARD FORM FIELDS
`Our D/C NO. · Our D.C No. DATE · REF DC NO · REF DC DATE · OK Qty · M/C rej. · MF · Total Qty ·
Rate/Pc · Sub Amount · I-GST 12 % · Grand Total Amount · REMARK-2`

Notes: **M/C rej.** (machine reject) and **MF** (material/RM fault) are **separate** columns; Total Qty =
OK + M/C rej + MF. "Our D/C" = our dispatch challan (no.+date); "REF DC" = the reference (inward/customer)
challan. GST rate here is 12% (rate is per-part, not fixed — the invoice sample used 18%).

---

## Page 4 — INVOICE MATERIAL DETAILS TO BE FETCHED
Same invoice line block as Page 1, with the **auto-fetch fields highlighted** — i.e. when generating
the invoice, these must be **pulled automatically** from the linked Inward + Outward (D.C) records, not
retyped:
- **Customer D.C No** + **Customer D.C Date** (from the dispatch challans)
- **Die No**, **IRC/Bin No**, **Heat No**, **RM Supplier** (from the source inward)
- (with Part Type / Part No / Finish Weight / Packing Mode / HSN / Qty / Rate flowing through too)

**Implication:** the invoice line is a *projection* of one part across its dispatch challans; the part-
identity + RM traceability fields come from the inward, the qty/date/D.C come from each outward dispatch.

---

## Page 5 — ATTENDANCE (two formats, one workbook: tabs DAILY PRODUCITON / DAILY WAGES / MASTER / REPORT-0 / REPORT-1)

### A) Production-based format (sheet "DAILY PRODUCITON")
Header: "Hemant Engineering Works, Chimbli-Pune" · DAILY PRODUCTION REPORT · Month (May-26).
Columns:
- **Basic:** Date · Shift No · M/c No · Type No · Operation No
- **Production Planning:** Standard · Plan
- Operator Name · Total Mat(erial)
- **Details of Production:** Ok Qty · Scrap · Rework · MF
- **Details of Down Time:** From · To · Total · Remark
- **Income:** Rate/Pc · Total Amount · Total Payment · Rate/Pc · Turnover…

### B) Shift-based format (sheet "DAILY WAGES", FORM NO. HEW/QAD/54/Ro)
Header: PAYMENT · TOTAL SALARY BOTH · Total Wages (222569) · Holiday · Month (May-26) · working-days calc `7-14-21-28=31-4=27`.
Columns: **Date · Name · Available From · Available To · Total Hrs Person · Shift Rate / 8 Hr · Total Amount**.

---

## Observations — gaps vs the current build

**Invoice (biggest gap).** The current invoice model/preview (`InvoicePdfModel`) carries Part No, HSN,
Challan, Qty, Rate, GST split, packing, amount-in-words — but the real invoice needs a lot more:
- **Part-identity block per line:** Part Type, **Die No**, **Drg Edt No**, **IRC/Bin No**, **Heat No**,
  **RM Supplier**, **Finish Weight**, **Packing Mode**.
- **Multi-D.C aggregation:** one part line spanning several Customer D.C No/Date rows that sum to a total qty.
- **Header extras:** PAN, **MSME No**, Email/Website, Pin, **PO/Jobwork Order No (+date)**, **customer's own
  Tax Invoice No**, **Motor Vehicle No**, **Dispatched Through**, **Destination**, Terms of Payment, Remark.
- **Footer extras:** Terms & Conditions block, GST self-certification text, machining notes, "(UNIT-n)" suffix.
- GST display labelled **CGST@9 + SGST@9** / **IGST@18** with the rate spelled out.

**Inward.** Mostly covered, but the client enters **RM Wt/pc** and **Finish Wt/pc** *per inward* (we derive
finish/scrap from the Part master). Confirm whether per-inward weights should override the master.

**Outward.** Client keeps **M/C rej.** and **MF** as two distinct columns + an explicit **Our D/C No/Date**
vs **REF DC No/Date** distinction, and a per-line **I-GST %**. Confirm our dispatch model surfaces both
reject buckets and both challan references on the form.

**Attendance.** Production format adds **Down-Time tracking (From/To/Total/Remark)**, **Rework**, **Type No**,
and **Total Payment/Turnover** columns; shift format is Date/Name/Avail-From/Avail-To/Total-Hrs/Shift-Rate-per-8h/Total.
Check these against the current Attendance & Payroll screen.
