/**
 * Navigation model — the SINGLE source for routes, sidebar, and breadcrumbs.
 * The router generates module routes from this list and the sidebar renders it
 * filtered by `can(module, 'view')`, so adding a module is one entry here.
 */
import {
  LayoutDashboard,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  FileSpreadsheet,
  ReceiptText,
  Wallet,
  Recycle,
  PackageX,
  Banknote,
  CalendarClock,
  Database,
  Tags,
  BarChart3,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import type { Module } from '@/types/rbac'

export interface NavItem {
  module: Module
  /** Route path. Dashboard is the index route ('/'). */
  to: string
  label: string
  icon: LucideIcon
  /** Short description shown on placeholder pages + as a sidebar tooltip. */
  blurb: string
  /** Build phase that ships the real screen (placeholder until then). */
  phase: string
  /** False until the real page is built (drives the placeholder vs page route). */
  ready: boolean
}

export interface NavSection {
  title: string
  items: NavItem[]
}

/** Standalone top-level links rendered above the grouped sections (no header,
 *  not collapsible) — Dashboard is the app "home". */
export const TOP_LEVEL: NavItem[] = [
  { module: 'dashboard', to: '/', label: 'Dashboard', icon: LayoutDashboard, blurb: 'KPIs, reconcile health and recent activity.', phase: 'P0', ready: true },
]

export const NAV_SECTIONS: NavSection[] = [
  {
    title: 'Operations',
    items: [
      { module: 'inward', to: '/inward', label: 'Inward / Outward', icon: ArrowDownToLine, blurb: 'Goods-received challans and the parent/child dispatch register.', phase: 'P2', ready: true },
      { module: 'dispatch', to: '/dispatch', label: 'Outward entry', icon: ArrowUpFromLine, blurb: 'Pick a parent challan and add one or more dispatch lines.', phase: 'P2', ready: true },
      { module: 'stock', to: '/stock', label: 'Stock', icon: Boxes, blurb: 'Live derived stock per unit & part.', phase: 'P2', ready: true },
      { module: 'import', to: '/import', label: 'Excel Import', icon: FileSpreadsheet, blurb: 'Drop the MIO workbook, map, validate, one undoable import.', phase: 'P3', ready: true },
    ],
  },
  {
    title: 'Billing & Finance',
    items: [
      { module: 'billing', to: '/billing', label: 'Billing', icon: ReceiptText, blurb: 'GST invoices per Bill No, issuer swap, PDF.', phase: 'P4', ready: true },
      { module: 'payments', to: '/payments', label: 'Payments', icon: Wallet, blurb: 'Receipts and allocation against invoices.', phase: 'P4', ready: true },
      { module: 'scrap', to: '/scrap', label: 'Scrap Billing', icon: Recycle, blurb: 'Scrap sales with GST + TCS.', phase: 'P5', ready: true },
      { module: 'rejection', to: '/rejection', label: 'Rejection Advice', icon: PackageX, blurb: 'Rejected-material delivery challans.', phase: 'P5', ready: true },
      { module: 'expenses', to: '/expenses', label: 'Expenses', icon: Banknote, blurb: 'Overheads with instalment tracking.', phase: 'P5', ready: true },
    ],
  },
  {
    title: 'Workforce',
    items: [
      { module: 'attendance', to: '/attendance', label: 'Attendance & Payroll', icon: CalendarClock, blurb: 'Production + shift attendance and earnings.', phase: 'P6', ready: true },
    ],
  },
  {
    title: 'Admin',
    items: [
      { module: 'masters', to: '/masters', label: 'Masters', icon: Database, blurb: 'Units, parts, vendors, customers, machines, opening stock.', phase: 'P1', ready: true },
      { module: 'rates', to: '/rates', label: 'Rate Masters', icon: Tags, blurb: 'Versioned RM & production rates.', phase: 'P1', ready: true },
      { module: 'reports', to: '/reports', label: 'Reports', icon: BarChart3, blurb: 'Registers, customer-wise summaries, reconcile report.', phase: 'P7', ready: true },
      { module: 'users', to: '/users', label: 'Users & Roles', icon: ShieldCheck, blurb: 'User management and the permission matrix.', phase: 'P8', ready: true },
    ],
  },
]

/** Flattened list (route generation + lookups) — top-level links + every section item. */
export const ALL_NAV: NavItem[] = [...TOP_LEVEL, ...NAV_SECTIONS.flatMap((s) => s.items)]

/** The nav entry whose route matches a pathname (most-specific match). */
export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/') return ALL_NAV.find((n) => n.to === '/')
  // Match on a path boundary so '/ratesX' never resolves to '/rates'.
  // Longest match wins (so '/masters/parts' resolves to Masters).
  return ALL_NAV.filter(
    (n) => n.to !== '/' && (pathname === n.to || pathname.startsWith(n.to + '/'))
  ).sort((a, b) => b.to.length - a.to.length)[0]
}

/** Human title for the current route (drives the topbar + document title). */
export function pageTitle(pathname: string): string {
  return navItemForPath(pathname)?.label ?? 'Not found'
}

/** Section + page label for the topbar breadcrumb ("Operations / Inward / Outward"). */
export function breadcrumbForPath(pathname: string): { section: string; label: string } {
  const item = navItemForPath(pathname)
  if (!item) return { section: '', label: 'Not found' }
  const section = NAV_SECTIONS.find((s) => s.items.some((i) => i.module === item.module))
  return { section: section?.title ?? '', label: item.label }
}
