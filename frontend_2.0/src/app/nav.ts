/**
 * Navigation model — the SINGLE source for routes, sidebar, and breadcrumbs.
 *
 * The sidebar is a flat, permission-filtered list arranged in business-flow
 * order: masters → inventory transactions → finance → workforce/admin.
 */
import {
  LayoutDashboard,
  Package,
  Truck,
  ArrowDownToLine,
  ArrowUpFromLine,
  Boxes,
  ReceiptText,
  Wallet,
  BarChart3,
  Settings,
  Database,
  Tags,
  FileSpreadsheet,
  Recycle,
  PackageX,
  CalendarClock,
  Building2,
  UserCog,
  Cpu,
  type LucideIcon,
} from 'lucide-react'
import type { Module } from '@/types/rbac'

export interface NavItem {
  module: Module
  /** Route path. */
  to: string
  label: string
  icon: LucideIcon
  /** Breadcrumb group + short description (sidebar tooltip / placeholder). */
  section: string
  blurb: string
  /** Legacy fields kept optional so Placeholder still typechecks (unused in v2). */
  phase?: string
  ready?: boolean
}

/**
 * Primary modules on the sidebar rail, rendered flat (no collapsible headers).
 */
export const SIDEBAR_ITEMS: NavItem[] = [
  { module: 'dashboard', to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard, section: 'Overview', blurb: 'KPIs, reconcile health, recent inward & invoices.' },

  // 1. Reference data used by every transaction
  { module: 'masters', to: '/masters', label: 'All Masters', icon: Database, section: 'Masters', blurb: 'Units, customers, machines, operations, employees and opening stock.' },
  { module: 'masters', to: '/materials', label: 'Raw Material Master', icon: Package, section: 'Masters', blurb: 'Priced part catalogue with HSN, weights, packing and PO defaults.' },
  { module: 'masters', to: '/vendors', label: 'Vendor Management', icon: Truck, section: 'Masters', blurb: 'Suppliers, GST profiles, banking and outstanding ledgers.' },
  { module: 'masters', to: '/customers', label: 'Customer Management', icon: Building2, section: 'Masters', blurb: 'Customers, GSTINs, billing states and payment terms.' },
  { module: 'masters', to: '/machines', label: 'Machine Management', icon: Cpu, section: 'Masters', blurb: 'Add and manage machines by unit.' },
  { module: 'masters', to: '/employees', label: 'Employee Management', icon: UserCog, section: 'Masters', blurb: 'Add and manage employees, labour types, shift rates and assigned units.' },
  { module: 'rates', to: '/rates', label: 'Rate Masters', icon: Tags, section: 'Masters', blurb: 'Configure versioned raw-material and production rates.' },

  // 2. Physical material flow: receive → hold → dispatch
  { module: 'inward', to: '/inward', label: 'Material Inward', icon: ArrowDownToLine, section: 'Inventory', blurb: 'Challan-wise material receipt with heat number and supplier.' },
  { module: 'stock', to: '/inventory', label: 'Inventory & Stock', icon: Boxes, section: 'Inventory', blurb: 'Live stock using controlled catalogue parts.' },
  { module: 'dispatch', to: '/outward', label: 'Material Outward', icon: ArrowUpFromLine, section: 'Inventory', blurb: 'Challan-cum-invoice dispatch with auto-GST and stock sync.' },

  // 3. Commercial and accounting flow
  { module: 'billing', to: '/billing', label: 'Billing & Invoice', icon: ReceiptText, section: 'Finance', blurb: 'Auto-generated GST tax invoices with HSN & challan traceability.' },
  { module: 'payments', to: '/payments', label: 'Payments', icon: Wallet, section: 'Finance', blurb: 'Receipts and allocation against invoices.' },
  { module: 'expenses', to: '/expenses', label: 'Expense Tracker', icon: Wallet, section: 'Finance', blurb: 'Outstanding balances, payment schedules and expense trends.' },
  { module: 'scrap', to: '/scrap', label: 'Scrap Billing', icon: Recycle, section: 'Finance', blurb: 'Scrap sales with GST + TCS.' },
  { module: 'rejection', to: '/rejection', label: 'Rejection Advice', icon: PackageX, section: 'Finance', blurb: 'Rejected-material delivery challans.' },

  // 4. Production workforce and management information
  { module: 'attendance', to: '/attendance', label: 'Attendance & Payroll', icon: CalendarClock, section: 'Workforce', blurb: 'Production + shift attendance and derived earnings.' },
  { module: 'reports', to: '/reports', label: 'Reports', icon: BarChart3, section: 'Reporting', blurb: 'Operational, financial and statutory reports — ready to download.' },

  // 5. System administration
  { module: 'import', to: '/import', label: 'Excel Import', icon: FileSpreadsheet, section: 'Administration', blurb: 'Import, map and validate operational workbook data.' },
  { module: 'users', to: '/users', label: 'User Management', icon: UserCog, section: 'Administration', blurb: 'Create operational users, assign units, set roles and status.' },
  { module: 'masters', to: '/settings', label: 'Settings', icon: Settings, section: 'Administration', blurb: 'Company profile, invoicing, units, roles and backups.' },
]

/**
 * Reserved for future deep-link-only functional screens.
 */
export const EXTRA_ROUTES: NavItem[] = [
]

/** Flattened list (route generation + lookups). Primary routes precede extras. */
export const ALL_NAV: NavItem[] = [...SIDEBAR_ITEMS, ...EXTRA_ROUTES]

/** The nav entry whose route matches a pathname (most-specific match). */
export function navItemForPath(pathname: string): NavItem | undefined {
  if (pathname === '/' || pathname === '/dashboard') return SIDEBAR_ITEMS[0]
  // Match on a path boundary so '/ratesX' never resolves to '/rates'.
  // Longest match wins (so '/masters/parts' resolves to Masters).
  return ALL_NAV.filter(
    (n) => pathname === n.to || pathname.startsWith(n.to + '/')
  ).sort((a, b) => b.to.length - a.to.length)[0]
}

/** Human title for the current route (drives the topbar + document title). */
export function pageTitle(pathname: string): string {
  return navItemForPath(pathname)?.label ?? 'Not found'
}

/** Section + page label for the topbar breadcrumb ("Operations / Dashboard"). */
export function breadcrumbForPath(pathname: string): { section: string; label: string } {
  const item = navItemForPath(pathname)
  if (!item) return { section: '', label: 'Not found' }
  return { section: item.section, label: item.label }
}
