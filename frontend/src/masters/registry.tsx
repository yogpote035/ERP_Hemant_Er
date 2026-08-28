/**
 * Master entity registry (plan §7 P1). One `defineMaster` spec per entity —
 * fields, columns, zod validation, and form↔entity mapping. The Masters/Rates
 * pages render these; the command-bus enforces RBAC per `module`.
 */
import { z } from 'zod'
import {
  Building2,
  Package,
  Truck,
  Users2,
  Cpu,
  Wrench,
  UserCog,
  Layers,
  Coins,
  Gauge,
} from 'lucide-react'
import type {
  Customer,
  Employee,
  Machine,
  Operation,
  Part,
  ProductionRate,
  RmRate,
  StockOpening,
  Unit,
  Vendor,
} from '@/types/domain'
import { toPaise, fromPaise, formatINR } from '@/lib/money'
import { todayISO } from '@/lib/date'
import { Badge } from '@/components/ui'
import { getById, patchEntity, values } from '@/store/normalized'
import { defineMaster } from './defineMaster'
import { unitOptions, partOptions, machineOptions, operationOptions, GST_OPTIONS } from './options'
import type { MasterView } from './types'

// ── shared helpers ────────────────────────────────────────────────────────────
const splitLines = (s?: string): string[] =>
  (s ?? '').split('\n').map((x) => x.trim()).filter(Boolean)
const joinLines = (xs: string[]): string => xs.join('\n')
const opt = (s?: string): string | undefined => (s && s.trim() ? s.trim() : undefined)

const activeCell = (row: { active?: boolean }) =>
  row.active === false ? <Badge tone="muted">Inactive</Badge> : <Badge tone="success">Active</Badge>

const STATE_HINT = '2-digit GST state code (e.g. 27 = MH)'

// Structural GSTIN: 2-digit state · 5-letter PAN-area · 4-digit · entity letter ·
// 1 alnum · 'Z' · 1 alnum checksum. Length-15 alone caught nothing on a legal invoice.
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][0-9A-Z]Z[0-9A-Z]$/
const GSTIN_MSG = 'Invalid GSTIN (e.g. 27ABCDE1234F1Z5)'
/** The GSTIN's leading 2 digits ARE the place-of-supply state — they must agree with
 *  the stored stateCode, else deriveTaxKind picks the wrong CGST/SGST-vs-IGST head. */
const gstinStateMismatch = (gstin?: string, stateCode?: string): boolean =>
  !!gstin && !!stateCode && gstin.trim().toUpperCase().slice(0, 2) !== stateCode

// ── Units ─────────────────────────────────────────────────────────────────────
const invoiceFormatSchema = z.string()
  .trim()
  .min(1, 'Required')
  .refine((value) => value.includes('{seq}'), 'Include {seq} for the invoice sequence')
  .refine((value) => value.includes('{FY}'), 'Include {FY} for the financial year')
  .refine(
    (value) => !/[{}]/.test(value.replace(/\{seq\}/g, '').replace(/\{FY\}/g, '')),
    'Only {seq} and {FY} placeholders are supported',
  )
  .refine(
    (value) => /^[A-Za-z0-9/-]+$/.test(value.replace(/\{seq\}/g, '1').replace(/\{FY\}/g, '24-25')),
    'Use only letters, numbers, / and -',
  )

const unitSchema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().min(1, 'Required'),
  gstin: z.string().regex(GSTIN_RE, GSTIN_MSG),
  stateCode: z.string().regex(/^\d{2}$/, 'Two digits'),
  invoiceFormat: invoiceFormatSchema,
  seqPad: z.number({ invalid_type_error: 'Number' }).int().min(1).max(8),
  addressLines: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  ifsc: z.string().optional(),
})
type UnitForm = z.infer<typeof unitSchema>

const unitMaster = defineMaster<Unit, UnitForm>({
  key: 'unit',
  module: 'masters',
  label: 'Unit',
  labelPlural: 'Units',
  icon: Building2,
  idPrefix: 'unit',
  softDelete: true,
  collection: (s) => s.masters.units,
  schema: unitSchema,
  columns: [
    { key: 'code', header: 'Code', render: (u) => <span className="font-medium">{u.code}</span> },
    { key: 'name', header: 'Name', render: (u) => u.name },
    { key: 'gstin', header: 'GSTIN', render: (u) => <span className="mono text-xs">{u.gstin}</span> },
    { key: 'state', header: 'State', render: (u) => u.stateCode },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Unit name', required: true, colSpan: 2 },
    { kind: 'text', name: 'code', label: 'Short code', required: true, placeholder: 'HEW', hint: 'Example: HEW for Hemant Engineering Works' },
    { kind: 'text', name: 'gstin', label: 'GSTIN', required: true },
    { kind: 'text', name: 'stateCode', label: 'State code', required: true, hint: STATE_HINT },
    { kind: 'number', name: 'seqPad', label: 'Invoice seq padding', required: true, min: 1, max: 8, hint: 'Example: padding 3 turns invoice sequence 7 into 007' },
    { kind: 'text', name: 'invoiceFormat', label: 'Invoice format', required: true, lockable: true, hint: 'Default: {seq}/{FY}. Unlock only if you need a custom format, e.g. HEW/{FY}/{seq} becomes HEW/2026-27/007', colSpan: 2 },
    { kind: 'textarea', name: 'addressLines', label: 'Address (one line each)', colSpan: 2 },
    { kind: 'text', name: 'bankName', label: 'Bank name' },
    { kind: 'text', name: 'accountNo', label: 'Account no.' },
    { kind: 'text', name: 'ifsc', label: 'IFSC' },
  ],
  emptyForm: () => ({ seqPad: 3, invoiceFormat: '{seq}/{FY}' }),
  toForm: (u) => ({
    name: u.name, code: u.code, gstin: u.gstin, stateCode: u.stateCode,
    invoiceFormat: u.invoiceFormat, seqPad: u.seqPad, addressLines: joinLines(u.addressLines),
    bankName: u.bankName ?? '', accountNo: u.accountNo ?? '', ifsc: u.ifsc ?? '',
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, name: v.name.trim(), code: v.code.trim(), gstin: v.gstin.trim().toUpperCase(),
    stateCode: v.stateCode, addressLines: splitLines(v.addressLines),
    invoiceFormat: v.invoiceFormat.trim(), seqPad: v.seqPad,
    bankName: opt(v.bankName), accountNo: opt(v.accountNo), ifsc: opt(v.ifsc),
    logoDataUrl: ctx.existing?.logoDataUrl,
    active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) => {
    const dup = values(s.masters.units).some(
      (u) => u.id !== existingId && u.code.trim().toLowerCase() === v.code.trim().toLowerCase()
    )
    if (dup) return 'A unit with this code already exists'
    if (gstinStateMismatch(v.gstin, v.stateCode)) return "GSTIN's first 2 digits must match the state code"
    return null
  },
  displayName: (u) => u.code,
})

// ── Parts ───────────────────────────────────────────────────────────────────── (weights entered in grams)
const partSchema = z.object({
  partNo: z.string().min(1, 'Required'),
  materialCode: z.string().min(1, 'Required'),
  description: z.string().optional(),
  unitId: z.string().min(1, 'Required'),
  uom: z.string().min(1, 'Required'),
  hsnSac: z.string().min(1, 'Required'),
  gstPct: z.string().min(1, 'Required'),
  finishWtG: z.number({ invalid_type_error: 'Number' }).nonnegative(),
  scrapWtG: z.number({ invalid_type_error: 'Number' }).nonnegative(),
  avgQtyPerBox: z.number({ invalid_type_error: 'Number' }).int().positive(),
  category: z.string().optional(),
  editionNo: z.string().optional(),
})
type PartForm = z.infer<typeof partSchema>

const partMaster = defineMaster<Part, PartForm>({
  key: 'part',
  module: 'masters',
  label: 'Part',
  labelPlural: 'Parts',
  icon: Package,
  idPrefix: 'part',
  softDelete: true,
  unitScoped: true,
  collection: (s) => s.masters.parts,
  schema: partSchema,
  columns: [
    { key: 'partNo', header: 'Part no.', render: (p) => <span className="font-medium">{p.partNo}</span> },
    { key: 'mat', header: 'Material', render: (p) => <span className="mono text-xs">{p.materialCode}</span> },
    { key: 'unit', header: 'Unit', render: (p, h) => h.unitCode(p.unitId) },
    { key: 'gst', header: 'GST', render: (p) => `${p.gstPct}%` },
    { key: 'hsn', header: 'HSN/SAC', render: (p) => <span className="mono text-xs">{p.hsnSac}</span> },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'partNo', label: 'Part number', required: true },
    { kind: 'text', name: 'materialCode', label: 'Material code', required: true },
    { kind: 'select', name: 'unitId', label: 'Unit', required: true, options: unitOptions },
    { kind: 'text', name: 'uom', label: 'UOM', required: true, placeholder: 'NOS / KG' },
    { kind: 'text', name: 'hsnSac', label: 'HSN/SAC', required: true },
    { kind: 'select', name: 'gstPct', label: 'GST %', required: true, options: GST_OPTIONS },
    { kind: 'number', name: 'finishWtG', label: 'Finish weight (g)', required: true, step: 0.001, min: 0 },
    { kind: 'number', name: 'scrapWtG', label: 'Scrap weight (g)', required: true, step: 0.001, min: 0 },
    { kind: 'number', name: 'avgQtyPerBox', label: 'Avg qty / box', required: true, min: 1 },
    { kind: 'text', name: 'category', label: 'Category' },
    { kind: 'text', name: 'editionNo', label: 'Edition no.' },
    { kind: 'textarea', name: 'description', label: 'Description', colSpan: 2 },
  ],
  emptyForm: () => ({ gstPct: '12', uom: 'NOS', avgQtyPerBox: 1 }),
  toForm: (p) => ({
    partNo: p.partNo, materialCode: p.materialCode, description: p.description ?? '',
    unitId: p.unitId, uom: p.uom, hsnSac: p.hsnSac, gstPct: String(p.gstPct),
    finishWtG: p.finishWtMg / 1000, scrapWtG: p.scrapWtMg / 1000, avgQtyPerBox: p.avgQtyPerBox,
    category: p.category ?? '', editionNo: p.editionNo ?? '',
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, partNo: v.partNo.trim(), materialCode: v.materialCode.trim(),
    description: opt(v.description), category: opt(v.category), editionNo: opt(v.editionNo),
    unitId: v.unitId, uom: v.uom.trim(), hsnSac: v.hsnSac.trim(), gstPct: Number(v.gstPct),
    finishWtMg: Math.round(v.finishWtG * 1000), scrapWtMg: Math.round(v.scrapWtG * 1000),
    avgQtyPerBox: v.avgQtyPerBox, active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) => {
    // Part no. is unique within its unit — a dup silently mis-binds Excel imports.
    const dup = values(s.masters.parts).some(
      (p) => p.id !== existingId && p.unitId === v.unitId && p.partNo.trim().toLowerCase() === v.partNo.trim().toLowerCase()
    )
    if (dup) return 'Part number already exists in this unit'
    // Moving a referenced part to another unit orphans its inward/stock/production history.
    if (existingId) {
      const cur = getById(s.masters.parts, existingId)
      if (cur && cur.unitId !== v.unitId) {
        const referenced =
          values(s.inventory.inwards).some((i) => i.partId === existingId) ||
          values(s.masters.stockOpenings).some((o) => o.partId === existingId) ||
          values(s.hr.production).some((p) => p.partId === existingId) ||
          values(s.rejection.rejectionAdvices).some((r) => r.partId === existingId) ||
          values(s.masters.rmRates).some((r) => r.partId === existingId) ||
          values(s.masters.productionRates).some((r) => r.partId === existingId)
        if (referenced) return "Can't change this part's unit — it already has inward / stock / production history"
      }
    }
    return null
  },
  displayName: (p) => p.partNo,
})

// ── Vendors ─────────────────────────────────────────────────────────────────────
const vendorSchema = z.object({
  name: z.string().min(1, 'Required'),
  code: z.string().min(1, 'Required'),
  type: z.enum(['rm', 'service']),
  contactPerson: z.string().optional(),
  phone: z.string().optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  // Optional, but must be well-formed when provided (RM vendors raise GST invoices).
  gstin: z.string().regex(GSTIN_RE, GSTIN_MSG).optional().or(z.literal('')),
  pan: z.string().optional(),
  stateCode: z.string().regex(/^\d{2}$/, 'Two digits').optional().or(z.literal('')),
  city: z.string().optional(),
  pincode: z.string().optional(),
  addressLines: z.string().optional(),
  bankName: z.string().optional(),
  accountNo: z.string().optional(),
  ifsc: z.string().optional(),
  remarks: z.string().optional(),
})
type VendorForm = z.infer<typeof vendorSchema>

const vendorMaster = defineMaster<Vendor, VendorForm>({
  key: 'vendor',
  module: 'masters',
  label: 'Vendor',
  labelPlural: 'Vendors',
  icon: Truck,
  idPrefix: 'vnd',
  softDelete: true,
  collection: (s) => s.masters.vendors,
  schema: vendorSchema,
  columns: [
    { key: 'code', header: 'Code', render: (v) => <span className="font-medium">{v.code}</span> },
    { key: 'name', header: 'Name', render: (v) => v.name },
    { key: 'type', header: 'Type', render: (v) => <Badge tone={v.type === 'rm' ? 'primary' : 'default'}>{v.type === 'rm' ? 'RM' : 'Service'}</Badge> },
    { key: 'gstin', header: 'GSTIN', render: (v) => <span className="mono text-xs">{v.gstin ?? '—'}</span> },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Vendor name', required: true, colSpan: 2 },
    { kind: 'text', name: 'code', label: 'Code', required: true },
    { kind: 'select', name: 'type', label: 'Type', required: true, options: [{ value: 'rm', label: 'Raw material' }, { value: 'service', label: 'Service' }] },
    { kind: 'text', name: 'contactPerson', label: 'Contact person' },
    { kind: 'text', name: 'phone', label: 'Phone' },
    { kind: 'text', name: 'email', label: 'Email' },
    { kind: 'text', name: 'gstin', label: 'GSTIN' },
    { kind: 'text', name: 'pan', label: 'PAN' },
    { kind: 'text', name: 'stateCode', label: 'State code', hint: STATE_HINT },
    { kind: 'text', name: 'city', label: 'City' },
    { kind: 'text', name: 'pincode', label: 'Pincode' },
    { kind: 'textarea', name: 'addressLines', label: 'Address (one line each)', colSpan: 2 },
    { kind: 'text', name: 'bankName', label: 'Bank name' },
    { kind: 'text', name: 'accountNo', label: 'Account no.' },
    { kind: 'text', name: 'ifsc', label: 'IFSC' },
    { kind: 'textarea', name: 'remarks', label: 'Remarks', colSpan: 2 },
  ],
  emptyForm: () => ({ type: 'service' }),
  toForm: (v) => ({
    name: v.name, code: v.code, type: v.type, contactPerson: v.contactPerson ?? '',
    phone: v.phone ?? '', email: v.email ?? '', gstin: v.gstin ?? '', pan: v.pan ?? '',
    stateCode: v.stateCode ?? '', city: v.city ?? '', pincode: v.pincode ?? '',
    addressLines: joinLines(v.addressLines), bankName: v.bankName ?? '',
    accountNo: v.accountNo ?? '', ifsc: v.ifsc ?? '', remarks: v.remarks ?? '',
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, name: v.name.trim(), code: v.code.trim(), type: v.type,
    contactPerson: opt(v.contactPerson), phone: opt(v.phone), email: opt(v.email),
    gstin: opt(v.gstin), pan: opt(v.pan), stateCode: opt(v.stateCode), city: opt(v.city),
    pincode: opt(v.pincode), addressLines: splitLines(v.addressLines), bankName: opt(v.bankName),
    accountNo: opt(v.accountNo), ifsc: opt(v.ifsc),
    invoiceFormat: ctx.existing?.invoiceFormat, remarks: opt(v.remarks),
    active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) => {
    const dup = values(s.masters.vendors).some(
      (x) => x.id !== existingId && x.code.trim().toLowerCase() === v.code.trim().toLowerCase()
    )
    if (dup) return 'A vendor with this code already exists'
    if (v.gstin && gstinStateMismatch(v.gstin, v.stateCode)) return "GSTIN's first 2 digits must match the state code"
    return null
  },
  displayName: (v) => v.code,
})

// ── Customers ─────────────────────────────────────────────────────────────────────
const customerSchema = z.object({
  name: z.string().min(1, 'Required'),
  gstin: z.string().regex(GSTIN_RE, GSTIN_MSG),
  stateCode: z.string().regex(/^\d{2}$/, 'Two digits'),
  paymentTermsDays: z.number({ invalid_type_error: 'Number' }).int().min(0).optional(),
  addressLines: z.string().optional(),
})
type CustomerForm = z.infer<typeof customerSchema>

const customerMaster = defineMaster<Customer, CustomerForm>({
  key: 'customer',
  module: 'masters',
  label: 'Customer',
  labelPlural: 'Customers',
  icon: Users2,
  idPrefix: 'cus',
  softDelete: true,
  collection: (s) => s.masters.customers,
  schema: customerSchema,
  columns: [
    { key: 'name', header: 'Name', render: (c) => <span className="font-medium">{c.name}</span> },
    { key: 'gstin', header: 'GSTIN', render: (c) => <span className="mono text-xs">{c.gstin}</span> },
    { key: 'state', header: 'State', render: (c) => c.stateCode },
    { key: 'terms', header: 'Terms', render: (c) => (c.paymentTermsDays != null ? `Net ${c.paymentTermsDays}` : '—') },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Customer name', required: true, colSpan: 2 },
    { kind: 'text', name: 'gstin', label: 'GSTIN', required: true },
    { kind: 'text', name: 'stateCode', label: 'State code', required: true, hint: STATE_HINT },
    { kind: 'number', name: 'paymentTermsDays', label: 'Payment terms (days)', min: 0 },
    { kind: 'textarea', name: 'addressLines', label: 'Address (one line each)', colSpan: 2 },
  ],
  emptyForm: () => ({}),
  toForm: (c) => ({
    name: c.name, gstin: c.gstin, stateCode: c.stateCode,
    paymentTermsDays: c.paymentTermsDays, addressLines: joinLines(c.addressLines),
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, name: v.name.trim(), gstin: v.gstin.trim().toUpperCase(), stateCode: v.stateCode,
    paymentTermsDays: v.paymentTermsDays, addressLines: splitLines(v.addressLines),
    active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) => {
    const dup = values(s.masters.customers).some(
      (c) => c.id !== existingId && c.gstin.trim().toUpperCase() === v.gstin.trim().toUpperCase()
    )
    if (dup) return 'A customer with this GSTIN already exists'
    if (gstinStateMismatch(v.gstin, v.stateCode)) return "GSTIN's first 2 digits must match the state code"
    return null
  },
  displayName: (c) => c.name,
})

// ── Machines ─────────────────────────────────────────────────────────────────────
const machineSchema = z.object({
  machineNo: z.string().min(1, 'Required'),
  description: z.string().optional(),
  unitId: z.string().min(1, 'Required'),
})
type MachineForm = z.infer<typeof machineSchema>

const machineMaster = defineMaster<Machine, MachineForm>({
  key: 'machine',
  module: 'masters',
  label: 'Machine',
  labelPlural: 'Machines',
  icon: Cpu,
  idPrefix: 'mch',
  softDelete: true,
  unitScoped: true,
  collection: (s) => s.masters.machines,
  schema: machineSchema,
  columns: [
    { key: 'no', header: 'Machine no.', render: (m) => <span className="font-medium">{m.machineNo}</span> },
    { key: 'desc', header: 'Description', render: (m) => m.description ?? '—' },
    { key: 'unit', header: 'Unit', render: (m, h) => h.unitCode(m.unitId) },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'machineNo', label: 'Machine number', required: true },
    { kind: 'select', name: 'unitId', label: 'Unit', required: true, options: unitOptions },
    { kind: 'textarea', name: 'description', label: 'Description', colSpan: 2 },
  ],
  emptyForm: () => ({}),
  toForm: (m) => ({ machineNo: m.machineNo, description: m.description ?? '', unitId: m.unitId }),
  toEntity: (v, ctx) => ({
    id: ctx.id, machineNo: v.machineNo.trim(), description: opt(v.description), unitId: v.unitId,
    active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) =>
    values(s.masters.machines).some(
      (m) => m.id !== existingId && m.unitId === v.unitId && m.machineNo.trim().toLowerCase() === v.machineNo.trim().toLowerCase()
    )
      ? 'A machine with this number already exists in this unit'
      : null,
  displayName: (m) => m.machineNo,
})

// ── Operations ─────────────────────────────────────────────────────────────────────
const operationSchema = z.object({
  code: z.string().min(1, 'Required'),
  description: z.string().optional(),
})
type OperationForm = z.infer<typeof operationSchema>

const operationMaster = defineMaster<Operation, OperationForm>({
  key: 'operation',
  module: 'masters',
  label: 'Operation',
  labelPlural: 'Operations',
  icon: Wrench,
  idPrefix: 'op',
  softDelete: true,
  collection: (s) => s.masters.operations,
  schema: operationSchema,
  columns: [
    { key: 'code', header: 'Code', render: (o) => <span className="font-medium">{o.code}</span> },
    { key: 'desc', header: 'Description', render: (o) => o.description ?? '—' },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'code', label: 'Operation code', required: true },
    { kind: 'textarea', name: 'description', label: 'Description', colSpan: 2 },
  ],
  emptyForm: () => ({}),
  toForm: (o) => ({ code: o.code, description: o.description ?? '' }),
  toEntity: (v, ctx) => ({
    id: ctx.id, code: v.code.trim(), description: opt(v.description), active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) =>
    values(s.masters.operations).some(
      (o) => o.id !== existingId && o.code.trim().toLowerCase() === v.code.trim().toLowerCase()
    )
      ? 'An operation with this code already exists'
      : null,
  displayName: (o) => o.code,
})

// ── Employees ─────────────────────────────────────────────────────────────────────
const employeeSchema = z.object({
  name: z.string().min(1, 'Required'),
  empCode: z.string().min(1, 'Required'),
  phone: z.string().optional(),
  labourType: z.enum(['production', 'shift', 'both']),
  standardShiftRate: z.number({ invalid_type_error: 'Number' }).nonnegative(),
  unitId: z.string().min(1, 'Required'),
})
type EmployeeForm = z.infer<typeof employeeSchema>

const employeeMaster = defineMaster<Employee, EmployeeForm>({
  key: 'employee',
  module: 'masters',
  label: 'Employee',
  labelPlural: 'Employees',
  icon: UserCog,
  idPrefix: 'emp',
  softDelete: true,
  unitScoped: true,
  collection: (s) => s.masters.employees,
  schema: employeeSchema,
  columns: [
    { key: 'code', header: 'Code', render: (e) => <span className="font-medium">{e.empCode}</span> },
    { key: 'name', header: 'Name', render: (e) => e.name },
    { key: 'type', header: 'Labour', render: (e) => e.labourType },
    { key: 'rate', header: 'Shift rate', className: 'text-right', render: (e) => <span className="mono">{formatINR(e.standardShiftRatePaise)}</span> },
    { key: 'unit', header: 'Unit', render: (e, h) => h.unitCode(e.unitId) },
    { key: 'active', header: 'Status', render: activeCell },
  ],
  fields: [
    { kind: 'text', name: 'name', label: 'Employee name', required: true },
    { kind: 'text', name: 'empCode', label: 'Employee code', required: true },
    { kind: 'text', name: 'phone', label: 'Phone' },
    { kind: 'select', name: 'labourType', label: 'Labour type', required: true, options: [
      { value: 'production', label: 'Production' }, { value: 'shift', label: 'Shift' }, { value: 'both', label: 'Both' },
    ] },
    { kind: 'money', name: 'standardShiftRate', label: 'Standard shift rate', required: true },
    { kind: 'select', name: 'unitId', label: 'Unit', required: true, options: unitOptions },
  ],
  emptyForm: () => ({ labourType: 'shift' }),
  toForm: (e) => ({
    name: e.name, empCode: e.empCode, phone: e.phone ?? '', labourType: e.labourType,
    standardShiftRate: fromPaise(e.standardShiftRatePaise), unitId: e.unitId,
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, name: v.name.trim(), empCode: v.empCode.trim(), phone: opt(v.phone),
    labourType: v.labourType, standardShiftRatePaise: toPaise(v.standardShiftRate), unitId: v.unitId,
    active: ctx.existing?.active ?? true,
  }),
  extraValidate: (v, s, existingId) =>
    values(s.masters.employees).some(
      (e) => e.id !== existingId && e.empCode.trim().toLowerCase() === v.empCode.trim().toLowerCase()
    )
      ? 'An employee with this code already exists'
      : null,
  displayName: (e) => e.empCode,
})

// ── Opening stock ─────────────────────────────────────────────────────────────────────
const openingSchema = z.object({
  unitId: z.string().min(1, 'Required'),
  partId: z.string().min(1, 'Required'),
  fy: z.string().regex(/^\d{2}-\d{2}$/, 'Format YY-YY (e.g. 24-25)'),
  openingQty: z.number({ invalid_type_error: 'Number' }).int().min(0),
  asOfDate: z.string().min(1, 'Required'),
})
type OpeningForm = z.infer<typeof openingSchema>

const openingMaster = defineMaster<StockOpening, OpeningForm>({
  key: 'opening',
  module: 'masters',
  label: 'Opening stock',
  labelPlural: 'Opening stock',
  icon: Layers,
  idPrefix: 'open',
  unitScoped: true,
  collection: (s) => s.masters.stockOpenings,
  schema: openingSchema,
  columns: [
    { key: 'unit', header: 'Unit', render: (o, h) => h.unitCode(o.unitId) },
    { key: 'part', header: 'Part', render: (o, h) => h.partLabel(o.partId) },
    { key: 'fy', header: 'FY', render: (o) => o.fy },
    { key: 'qty', header: 'Opening qty', className: 'text-right', render: (o) => <span className="mono">{o.openingQty.toLocaleString('en-IN')}</span> },
    { key: 'date', header: 'As of', render: (o) => o.asOfDate },
  ],
  fields: [
    { kind: 'select', name: 'unitId', label: 'Unit', required: true, options: unitOptions },
    { kind: 'select', name: 'partId', label: 'Part', required: true, options: partOptions },
    { kind: 'text', name: 'fy', label: 'Financial year', required: true, placeholder: '24-25' },
    { kind: 'number', name: 'openingQty', label: 'Opening quantity', required: true, min: 0 },
    { kind: 'date', name: 'asOfDate', label: 'As of date', required: true },
  ],
  emptyForm: () => ({ asOfDate: todayISO() }),
  toForm: (o) => ({ unitId: o.unitId, partId: o.partId, fy: o.fy, openingQty: o.openingQty, asOfDate: o.asOfDate }),
  toEntity: (v, ctx) => ({
    id: ctx.id, unitId: v.unitId, partId: v.partId, fy: v.fy, openingQty: v.openingQty, asOfDate: v.asOfDate,
  }),
  // A part belongs to exactly one unit (FR-RM03a) — opening must match it.
  extraValidate: (v, s, existingId) => {
    const part = s.masters.parts.byId[v.partId]
    if (part && part.unitId !== v.unitId) return 'That part belongs to a different unit'
    // Opening is the single go-live carry-forward per (unit, part). Stock is
    // lifetime-cumulative (never FY-scoped), so a second opening row — e.g. one
    // per financial year — would double-count on-hand quantity. Enforce one row.
    const dup = values(s.masters.stockOpenings).some(
      (o) => o.id !== existingId && o.unitId === v.unitId && o.partId === v.partId
    )
    if (dup) return 'Opening stock already exists for this part — edit the existing row'
    return null
  },
  displayName: (o) => `${o.fy} opening`,
})

// ── RM rates ─────────────────────────────────────────────────────────────────────
const rmRateSchema = z.object({
  partId: z.string().min(1, 'Required'),
  rate: z.number({ invalid_type_error: 'Number' }).nonnegative(),
  effectiveFrom: z.string().min(1, 'Required'),
})
type RmRateForm = z.infer<typeof rmRateSchema>

const rmRateMaster = defineMaster<RmRate, RmRateForm>({
  key: 'rmRate',
  module: 'rates',
  label: 'RM rate',
  labelPlural: 'RM rates',
  icon: Coins,
  idPrefix: 'rm',
  collection: (s) => s.masters.rmRates,
  schema: rmRateSchema,
  columns: [
    { key: 'part', header: 'Part', render: (r, h) => h.partLabel(r.partId) },
    { key: 'rate', header: 'Rate', className: 'text-right', render: (r) => <span className="mono">{formatINR(r.ratePaise)}</span> },
    { key: 'from', header: 'Effective from', render: (r) => r.effectiveFrom },
    { key: 'super', header: 'Superseded', render: (r) => r.supersededAt ?? <Badge tone="success">Current</Badge> },
  ],
  fields: [
    { kind: 'select', name: 'partId', label: 'Part', required: true, options: partOptions, colSpan: 2 },
    { kind: 'money', name: 'rate', label: 'Rate per piece', required: true },
    { kind: 'date', name: 'effectiveFrom', label: 'Effective from', required: true },
  ],
  emptyForm: () => ({ effectiveFrom: todayISO() }),
  toForm: (r) => ({ partId: r.partId, rate: fromPaise(r.ratePaise), effectiveFrom: r.effectiveFrom }),
  toEntity: (v, ctx) => ({
    id: ctx.id, partId: v.partId, ratePaise: toPaise(v.rate), effectiveFrom: v.effectiveFrom,
    supersededAt: ctx.existing?.supersededAt,
  }),
  // A new RM rate supersedes the prior current rate for the same part.
  afterUpsert: (draft, entity) => {
    for (const r of values(draft.masters.rmRates)) {
      if (r.id !== entity.id && r.partId === entity.partId && !r.supersededAt && r.effectiveFrom <= entity.effectiveFrom) {
        patchEntity(draft.masters.rmRates, r.id, { supersededAt: entity.effectiveFrom })
      }
    }
  },
  displayName: (r) => r.id,
})

// ── Production rates ─────────────────────────────────────────────────────────────────────
const prodRateSchema = z.object({
  partId: z.string().min(1, 'Required'),
  machineId: z.string().optional(),
  operationId: z.string().optional(),
  rate: z.number({ invalid_type_error: 'Number' }).nonnegative(),
  effectiveFrom: z.string().min(1, 'Required'),
})
type ProdRateForm = z.infer<typeof prodRateSchema>

const prodRateMaster = defineMaster<ProductionRate, ProdRateForm>({
  key: 'prodRate',
  module: 'rates',
  label: 'Production rate',
  labelPlural: 'Production rates',
  icon: Gauge,
  idPrefix: 'pr',
  collection: (s) => s.masters.productionRates,
  schema: prodRateSchema,
  columns: [
    { key: 'part', header: 'Part', render: (r, h) => h.partLabel(r.partId) },
    { key: 'machine', header: 'Machine', render: (r, h) => h.machineLabel(r.machineId) },
    { key: 'op', header: 'Operation', render: (r, h) => h.operationLabel(r.operationId) },
    { key: 'rate', header: 'Rate', className: 'text-right', render: (r) => <span className="mono">{formatINR(r.ratePaise)}</span> },
    { key: 'from', header: 'Effective from', render: (r) => r.effectiveFrom },
  ],
  fields: [
    { kind: 'select', name: 'partId', label: 'Part', required: true, options: partOptions, colSpan: 2 },
    { kind: 'select', name: 'machineId', label: 'Machine', options: machineOptions },
    { kind: 'select', name: 'operationId', label: 'Operation', options: operationOptions },
    { kind: 'money', name: 'rate', label: 'Rate per piece', required: true },
    { kind: 'date', name: 'effectiveFrom', label: 'Effective from', required: true },
  ],
  emptyForm: () => ({ effectiveFrom: todayISO() }),
  toForm: (r) => ({
    partId: r.partId, machineId: r.machineId ?? '', operationId: r.operationId ?? '',
    rate: fromPaise(r.ratePaise), effectiveFrom: r.effectiveFrom,
  }),
  toEntity: (v, ctx) => ({
    id: ctx.id, partId: v.partId, machineId: opt(v.machineId), operationId: opt(v.operationId),
    ratePaise: toPaise(v.rate), effectiveFrom: v.effectiveFrom, supersededAt: ctx.existing?.supersededAt,
  }),
  // A new production rate supersedes the prior current rate for the same part+machine+operation.
  afterUpsert: (draft, entity) => {
    for (const r of values(draft.masters.productionRates)) {
      if (
        r.id !== entity.id && r.partId === entity.partId &&
        r.machineId === entity.machineId && r.operationId === entity.operationId &&
        !r.supersededAt && r.effectiveFrom <= entity.effectiveFrom
      ) {
        patchEntity(draft.masters.productionRates, r.id, { supersededAt: entity.effectiveFrom })
      }
    }
  },
  displayName: (r) => r.id,
})

// ── exports ─────────────────────────────────────────────────────────────────────
export const MASTER_SPECS: MasterView[] = [
  unitMaster, partMaster, vendorMaster, customerMaster,
  machineMaster, operationMaster, employeeMaster, openingMaster,
]
export const RATE_SPECS: MasterView[] = [rmRateMaster, prodRateMaster]
export const ALL_SPECS: MasterView[] = [...MASTER_SPECS, ...RATE_SPECS]
