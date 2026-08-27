/**
 * reports.ts (plan P7) — config-driven report registry. Each report is a pure
 * builder over the unit-scoped derived selectors from P2-P6, returning display
 * columns + plain rows ready for both the on-screen table and the Excel export.
 * Date-bearing reports honour the date range; aggregates ignore it.
 *
 * Unit scope is passed explicitly to `build` as `allowed?: Set<Id> | null`
 * (null = no scoping; the route layer supplies `req.auth.allowedUnitIds`).
 */
import type { Id } from '../types/domain.js'
import type { RootState } from '../db/state.js'
import { getById } from '../db/normalized.js'
import { addP, type Paise } from '../lib/money.js'
import { formatDMY, formatINRSymbol } from './format.js'
import { selectInwardRows, selectStockRows } from './register.js'
import { selectInvoiceRows } from './invoiceCompute.js'
import { selectScrapRows, selectExpenseRows, scrapMathOf } from './finance.js'
import { selectEarnings } from './attendance.js'

const ZERO = 0 as Paise

export interface ReportColumn {
  key: string
  label: string
  align?: 'left' | 'right'
}
export type ReportRow = Record<string, string | number>
export interface ReportResult {
  columns: ReportColumn[]
  rows: ReportRow[]
}
export interface DateRange {
  from?: string
  to?: string
}
export interface ReportDef {
  key: string
  label: string
  /** Whether the date range applies (drives the From/To inputs being shown). */
  dateFiltered: boolean
  build: (s: RootState, range: DateRange, allowed?: Set<Id> | null) => ReportResult
}

const within = (d: string | undefined, r: DateRange): boolean =>
  !d ? true : (!r.from || d >= r.from) && (!r.to || d <= r.to)

const intFmt = (n: number) => n.toLocaleString('en-IN')

export const REPORTS: ReportDef[] = [
  {
    key: 'inward-outward',
    label: 'Inward / Outward register',
    dateFiltered: true,
    build: (s, r, allowed = null) => ({
      columns: [
        { key: 'challan', label: 'Challan' },
        { key: 'date', label: 'Date' },
        { key: 'part', label: 'Part' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'received', label: 'Received', align: 'right' },
        { key: 'dispatched', label: 'Dispatched', align: 'right' },
        { key: 'balance', label: 'Balance' },
      ],
      rows: selectInwardRows(s, allowed)
        .filter((row) => within(row.inward.challanDate, r))
        .map((row) => ({
          challan: row.inward.challanNo,
          date: formatDMY(row.inward.challanDate),
          part: row.partNo,
          vendor: row.vendorName,
          received: row.received,
          dispatched: row.dispatched,
          balance: row.balance,
        })),
    }),
  },
  {
    key: 'billing-summary',
    label: 'Billing summary',
    dateFiltered: true,
    build: (s, r, allowed = null) => ({
      columns: [
        { key: 'billNo', label: 'Bill no' },
        { key: 'customer', label: 'Customer' },
        { key: 'date', label: 'Date' },
        { key: 'status', label: 'Status' },
        { key: 'grand', label: 'Grand', align: 'right' },
        { key: 'outstanding', label: 'Outstanding', align: 'right' },
      ],
      rows: selectInvoiceRows(s, allowed)
        .filter((row) => within(row.invoice.invoiceDate, r))
        .map((row) => ({
          billNo: row.invoice.billNo,
          customer: row.customerName,
          date: row.invoice.invoiceDate ? formatDMY(row.invoice.invoiceDate) : '—',
          status: row.status,
          grand: formatINRSymbol(row.grand),
          outstanding: row.status === 'paid' || row.status === 'void' ? '—' : formatINRSymbol(row.outstanding),
        })),
    }),
  },
  {
    key: 'customer-revenue',
    label: 'Customer-wise revenue',
    dateFiltered: true,
    build: (s, r, allowed = null) => {
      const agg = new Map<string, { invoices: number; invoiced: Paise; outstanding: Paise }>()
      for (const row of selectInvoiceRows(s, allowed)) {
        if (row.invoice.lifecycle !== 'sent') continue
        if (!within(row.invoice.invoiceDate, r)) continue
        const cur = agg.get(row.customerName) ?? { invoices: 0, invoiced: ZERO, outstanding: ZERO }
        cur.invoices += 1
        cur.invoiced = addP(cur.invoiced, row.grand)
        cur.outstanding = addP(cur.outstanding, row.outstanding)
        agg.set(row.customerName, cur)
      }
      return {
        columns: [
          { key: 'customer', label: 'Customer' },
          { key: 'invoices', label: 'Invoices', align: 'right' },
          { key: 'invoiced', label: 'Invoiced', align: 'right' },
          { key: 'outstanding', label: 'Outstanding', align: 'right' },
        ],
        rows: [...agg.entries()]
          .sort((a, b) => b[1].invoiced - a[1].invoiced)
          .map(([customer, v]) => ({
            customer,
            invoices: v.invoices,
            invoiced: formatINRSymbol(v.invoiced),
            outstanding: formatINRSymbol(v.outstanding),
          })),
      }
    },
  },
  {
    key: 'stock',
    label: 'Stock (per unit & part)',
    dateFiltered: false,
    build: (s, _r, allowed = null) => ({
      columns: [
        { key: 'unit', label: 'Unit' },
        { key: 'part', label: 'Part' },
        { key: 'opening', label: 'Opening', align: 'right' },
        { key: 'received', label: 'Received', align: 'right' },
        { key: 'consumed', label: 'Consumed', align: 'right' },
        { key: 'available', label: 'Available', align: 'right' },
        { key: 'reconciled', label: 'Reconciled' },
      ],
      rows: selectStockRows(s, undefined, undefined, allowed).map((row) => ({
        unit: getById(s.masters.units, row.unitId)?.code ?? row.unitId,
        part: row.partNo,
        opening: row.opening,
        received: row.received,
        consumed: row.consumed,
        available: row.available,
        reconciled: row.balanced ? 'Yes' : 'No',
      })),
    }),
  },
  {
    key: 'scrap',
    label: 'Scrap sales',
    dateFiltered: true,
    build: (s, r, allowed = null) => ({
      columns: [
        { key: 'invoice', label: 'Invoice' },
        { key: 'date', label: 'Date' },
        { key: 'customer', label: 'Customer' },
        { key: 'weightKg', label: 'Weight (kg)', align: 'right' },
        { key: 'tcs', label: 'TCS', align: 'right' },
        { key: 'grand', label: 'Grand', align: 'right' },
      ],
      rows: selectScrapRows(s, allowed)
        .filter((row) => within(row.bill.invoiceDate, r))
        .map((row) => ({
          invoice: row.bill.scrapInvoiceNo,
          date: formatDMY(row.bill.invoiceDate),
          customer: row.customerName,
          weightKg: intFmt(row.bill.weightGrams / 1000),
          tcs: formatINRSymbol(scrapMathOf(row.bill).tcs),
          grand: formatINRSymbol(row.grand),
        })),
    }),
  },
  {
    key: 'expenses',
    label: 'Expense outstanding',
    dateFiltered: true,
    build: (s, r, allowed = null) => ({
      columns: [
        { key: 'date', label: 'Date' },
        { key: 'category', label: 'Category' },
        { key: 'vendor', label: 'Vendor' },
        { key: 'total', label: 'Total', align: 'right' },
        { key: 'paid', label: 'Paid', align: 'right' },
        { key: 'balance', label: 'Balance', align: 'right' },
        { key: 'status', label: 'Status' },
      ],
      rows: selectExpenseRows(s, allowed)
        .filter((row) => within(row.expense.date, r))
        .map((row) => ({
          date: formatDMY(row.expense.date),
          category: row.expense.category,
          vendor: row.vendorName,
          total: formatINRSymbol(row.expense.totalPaise),
          paid: formatINRSymbol(row.paid),
          balance: formatINRSymbol(row.balance),
          status: row.status,
        })),
    }),
  },
  {
    key: 'attendance-earnings',
    label: 'Attendance earnings',
    dateFiltered: false,
    build: (s, _r, allowed = null) => ({
      columns: [
        { key: 'employee', label: 'Employee' },
        { key: 'production', label: 'Production', align: 'right' },
        { key: 'shift', label: 'Shift wage', align: 'right' },
        { key: 'total', label: 'Total', align: 'right' },
      ],
      rows: selectEarnings(s, allowed).map((row) => ({
        employee: row.employeeName,
        production: formatINRSymbol(row.productionEarned),
        shift: formatINRSymbol(row.shiftWage),
        total: formatINRSymbol(row.total),
      })),
    }),
  },
]

export function reportByKey(key: string): ReportDef | undefined {
  return REPORTS.find((r) => r.key === key)
}
