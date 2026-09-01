import { z } from 'zod'
import type { Inward } from '@/types/domain'
import { todayISO } from '@/lib/date'
import { toPaise, fromPaise } from '@/lib/money'
import type { FieldSpec } from '@/masters/types'
import { unitOptions, partOptions, rmVendorOptions, customerOptions } from '@/masters/options'
import type { InwardInput } from '@/store/registerCommands'

export const inwardSchema = z.object({
  unitId: z.string().min(1, 'Required'),
  partId: z.string().min(1, 'Required'),
  challanNo: z.string().optional().default(''),
  challanDate: z.string().optional().default(''),
  poNo: z.string().optional(),
  dieNo: z.string().optional(),
  batchHeatNo: z.string().optional().default(''),
  binNo: z.string().optional(),
  vendorId: z.string().optional(),
  // Per-inward traceability (client Inward format): RM rate ₹/pc, RM & finish wt g/pc.
  rmRate: z.number({ invalid_type_error: 'Number' }).nonnegative().optional(),
  rmWtG: z.number({ invalid_type_error: 'Number' }).nonnegative().optional(),
  finishWtG: z.number({ invalid_type_error: 'Number' }).nonnegative().optional(),
  receivedQty: z.number({ invalid_type_error: 'Number' }).int().positive(),
  customerId: z.string().optional(),
  remarks: z.string().optional(),
})
export type InwardFormValues = z.infer<typeof inwardSchema>

// Field order mirrors the client's Inward format:
// Challan No · Challan Date · Part No · PO No · Die No · Batch/Heat No · Bin No ·
// RM Supplier · RM Rate/pc · RM Wt/pc · Finish Wt/pc · Received QTY (+ Unit, Customer).
export const inwardFields: FieldSpec[] = [
  { kind: 'select', name: 'unitId', label: 'Assigned Unit', required: true, options: unitOptions },
  { kind: 'text', name: 'challanNo', label: 'Challan no.' },
  { kind: 'date', name: 'challanDate', label: 'Challan date' },
  { kind: 'select', name: 'partId', label: 'Catalogue part', required: true, options: partOptions, hint: 'Prefills assigned unit, PO, RM rate and weights when present; missing values remain editable.' },
  { kind: 'text', name: 'poNo', label: 'PO no.' },
  { kind: 'text', name: 'dieNo', label: 'Die no.' },
  { kind: 'text', name: 'batchHeatNo', label: 'Batch / heat no.' },
  { kind: 'text', name: 'binNo', label: 'Bin no.' },
  { kind: 'select', name: 'vendorId', label: 'RM supplier', options: rmVendorOptions },
  { kind: 'number', name: 'rmRate', label: 'RM Rate / pc (₹)', step: 0.01, min: 0 },
  { kind: 'number', name: 'rmWtG', label: 'RM Wt / pc (g)', step: 0.001, min: 0 },
  { kind: 'number', name: 'finishWtG', label: 'Finish Wt / pc (g)', step: 0.001, min: 0 },
  { kind: 'number', name: 'receivedQty', label: 'Received qty', required: true, min: 1 },
  { kind: 'select', name: 'customerId', label: 'Customer / owner', options: customerOptions },
  { kind: 'textarea', name: 'remarks', label: 'Remarks', colSpan: 2 },
]

export function inwardDefaults(): InwardFormValues {
  return {
    unitId: '', partId: '', challanNo: '', challanDate: todayISO(), vendorId: '', customerId: '',
    batchHeatNo: '', receivedQty: undefined as unknown as number, poNo: '', dieNo: '', binNo: '',
    rmRate: undefined, rmWtG: undefined, finishWtG: undefined, remarks: '',
  }
}

export function inwardToValues(i: Inward): InwardFormValues {
  return {
    unitId: i.unitId, partId: i.partId, challanNo: i.challanNo, challanDate: i.challanDate,
    vendorId: i.vendorId ?? '', customerId: i.customerId ?? '', batchHeatNo: i.batchHeatNo,
    receivedQty: i.receivedQty, poNo: i.poNo ?? '', dieNo: i.dieNo ?? '', binNo: i.binNo ?? '',
    rmRate: i.rmRatePaise != null ? fromPaise(i.rmRatePaise) : undefined,
    rmWtG: i.rmWtMg != null ? i.rmWtMg / 1000 : undefined,
    finishWtG: i.finishWtMg != null ? i.finishWtMg / 1000 : undefined,
    remarks: i.remarks ?? '',
  }
}

const blank = (s?: string): string | undefined => (s && s.trim() ? s : undefined)

/** Map validated form values + optional id to the command input. */
export function inwardValuesToInput(v: InwardFormValues, id?: string): InwardInput {
  return {
    id,
    unitId: v.unitId,
    partId: v.partId,
    challanNo: v.challanNo,
    challanDate: v.challanDate,
    vendorId: blank(v.vendorId),
    customerId: blank(v.customerId),
    batchHeatNo: v.batchHeatNo,
    receivedQty: v.receivedQty,
    poNo: blank(v.poNo),
    dieNo: blank(v.dieNo),
    binNo: blank(v.binNo),
    rmRatePaise: v.rmRate != null ? toPaise(v.rmRate) : undefined,
    rmWtMg: v.rmWtG != null ? Math.round(v.rmWtG * 1000) : undefined,
    finishWtMg: v.finishWtG != null ? Math.round(v.finishWtG * 1000) : undefined,
    remarks: blank(v.remarks),
  }
}
