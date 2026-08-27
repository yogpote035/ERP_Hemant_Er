import { z } from 'zod'
import type { Inward } from '@/types/domain'
import { todayISO } from '@/lib/date'
import type { FieldSpec } from '@/masters/types'
import { unitOptions, partOptions, vendorOptions, customerOptions } from '@/masters/options'
import type { InwardInput } from '@/store/registerCommands'

export const inwardSchema = z.object({
  unitId: z.string().min(1, 'Required'),
  partId: z.string().min(1, 'Required'),
  challanNo: z.string().min(1, 'Required'),
  challanDate: z.string().min(1, 'Required'),
  vendorId: z.string().optional(),
  customerId: z.string().optional(),
  batchHeatNo: z.string().min(1, 'Required'),
  receivedQty: z.number({ invalid_type_error: 'Number' }).int().positive(),
  poNo: z.string().optional(),
  dieNo: z.string().optional(),
  binNo: z.string().optional(),
  remarks: z.string().optional(),
})
export type InwardFormValues = z.infer<typeof inwardSchema>

export const inwardFields: FieldSpec[] = [
  { kind: 'select', name: 'unitId', label: 'Unit', required: true, options: unitOptions },
  { kind: 'select', name: 'partId', label: 'Part', required: true, options: partOptions },
  { kind: 'text', name: 'challanNo', label: 'Challan no.', required: true },
  { kind: 'date', name: 'challanDate', label: 'Challan date', required: true },
  { kind: 'select', name: 'vendorId', label: 'RM supplier (vendor)', options: vendorOptions },
  { kind: 'select', name: 'customerId', label: 'Customer / owner', options: customerOptions },
  { kind: 'text', name: 'batchHeatNo', label: 'Batch / heat no.', required: true },
  { kind: 'number', name: 'receivedQty', label: 'Received qty', required: true, min: 1 },
  { kind: 'text', name: 'poNo', label: 'PO no.' },
  { kind: 'text', name: 'dieNo', label: 'Die no.' },
  { kind: 'text', name: 'binNo', label: 'Bin no.' },
  { kind: 'textarea', name: 'remarks', label: 'Remarks', colSpan: 2 },
]

export function inwardDefaults(): InwardFormValues {
  return {
    unitId: '', partId: '', challanNo: '', challanDate: todayISO(), vendorId: '', customerId: '',
    batchHeatNo: '', receivedQty: undefined as unknown as number, poNo: '', dieNo: '', binNo: '', remarks: '',
  }
}

export function inwardToValues(i: Inward): InwardFormValues {
  return {
    unitId: i.unitId, partId: i.partId, challanNo: i.challanNo, challanDate: i.challanDate,
    vendorId: i.vendorId ?? '', customerId: i.customerId ?? '', batchHeatNo: i.batchHeatNo,
    receivedQty: i.receivedQty, poNo: i.poNo ?? '', dieNo: i.dieNo ?? '', binNo: i.binNo ?? '', remarks: i.remarks ?? '',
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
    remarks: blank(v.remarks),
  }
}
