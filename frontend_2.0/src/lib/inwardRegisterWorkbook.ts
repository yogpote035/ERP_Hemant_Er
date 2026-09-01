import { fromPaise, mulQty } from '@/lib/money'
import type { InwardRow } from '@/selectors/register'
import type { ExportColumn } from '@/lib/exportXlsx'

/** One shared layout for register exports and the import wizard's sample sheet. */
export const INWARD_REGISTER_COLUMNS: ExportColumn[] = [
  { key: 'challanNo', label: 'Delivery Challan No' },
  { key: 'challanDate', label: 'Challan Date' },
  { key: 'partNo', label: 'Part No' },
  { key: 'vendor', label: 'Vendor' },
  { key: 'poNo', label: 'PO No' },
  { key: 'batchHeatNo', label: 'Batch & Heat No' },
  { key: 'rmRate', label: 'RM Rate' },
  { key: 'receivedQty', label: 'Received Qty' },
  { key: 'dispatchType', label: 'Dispatch Type' },
  { key: 'billNo', label: 'Bill No' },
  { key: 'billDate', label: 'Bill Date' },
  { key: 'dispatchDate', label: 'Dispatch Date' },
  { key: 'okQty', label: 'OK / Dispatch Qty' },
  { key: 'mrQty', label: 'MR Qty' },
  { key: 'mfQty', label: 'MF Qty' },
  { key: 'totalDispatchQty', label: 'Total Dispatch Qty' },
  { key: 'ratePerPc', label: 'Rate / Pc' },
  { key: 'gstPct', label: 'GST %' },
  { key: 'outwardValue', label: 'Outward Value (ex-GST)' },
  { key: 'customerInvoiceNo', label: 'Customer Invoice No' },
  { key: 'customerInvoiceDate', label: 'Customer Invoice Date' },
  { key: 'availableQty', label: 'Available Qty' },
  { key: 'status', label: 'Status' },
]

export const INWARD_REGISTER_SAMPLE_ROWS: Record<string, unknown>[] = [
  {
    challanNo: 'DC/26-27/001', challanDate: '2026-04-01', partNo: 'PART-001', vendor: 'Example Vendor',
    poNo: 'PO-001', batchHeatNo: 'HEAT-001', rmRate: 125, receivedQty: 1000, dispatchType: 'Billed',
    billNo: '001/26-27', billDate: '2026-04-10', dispatchDate: '2026-04-10', okQty: 600,
    mrQty: 5, mfQty: 2, totalDispatchQty: 607, ratePerPc: 15, gstPct: 18,
    outwardValue: 9000, customerInvoiceNo: 'CUST-INV-001', customerInvoiceDate: '2026-04-10',
    availableQty: 393, status: 'Open',
  },
  {
    // Additional dispatch for the challan above: inward columns intentionally blank.
    challanNo: '', challanDate: '', partNo: '', vendor: '', poNo: '', batchHeatNo: '', rmRate: '', receivedQty: '',
    dispatchType: 'Billed', billNo: '002/26-27', billDate: '2026-04-15', dispatchDate: '2026-04-15',
    okQty: 393, mrQty: 0, mfQty: 0, totalDispatchQty: 393, ratePerPc: 15, gstPct: 18,
    outwardValue: 5895, customerInvoiceNo: '', customerInvoiceDate: '', availableQty: 0, status: 'Dispatched',
  },
]

const blankInward = {
  challanNo: '', challanDate: '', partNo: '', vendor: '', poNo: '', batchHeatNo: '', rmRate: '', receivedQty: '',
}

export function buildInwardRegisterExportRows(rows: InwardRow[]): Record<string, unknown>[] {
  return rows.flatMap((row): Record<string, unknown>[] => {
    const base = {
      challanNo: row.inward.challanNo,
      challanDate: row.inward.challanDate,
      partNo: row.partNo,
      vendor: row.vendorName,
      poNo: row.inward.poNo ?? '',
      batchHeatNo: row.inward.batchHeatNo,
      rmRate: row.inward.rmRatePaise != null ? fromPaise(row.inward.rmRatePaise) : '',
      receivedQty: row.received,
    }
    const balance = { availableQty: row.available, status: row.balance }
    if (row.children.length === 0) {
      return [{
        ...base, dispatchType: '', billNo: '', billDate: '', dispatchDate: '', okQty: '', mrQty: '', mfQty: '',
        totalDispatchQty: '', ratePerPc: '', gstPct: '', outwardValue: '', customerInvoiceNo: '', customerInvoiceDate: '',
        ...balance,
      }]
    }
    return row.children.map(({ dispatch, total, invoiceBillNo }, index) => ({
      ...(index === 0 ? base : blankInward),
      dispatchType: dispatch.kind === 'billed' ? 'Billed' : 'Rejection',
      billNo: invoiceBillNo ?? dispatch.billNo ?? '',
      billDate: dispatch.billDate ?? '',
      dispatchDate: dispatch.dispatchDate ?? '',
      okQty: dispatch.okQty,
      mrQty: dispatch.mcRejQty,
      mfQty: dispatch.mfQty,
      totalDispatchQty: total,
      ratePerPc: dispatch.rateSnapshotPaise != null ? fromPaise(dispatch.rateSnapshotPaise) : '',
      gstPct: dispatch.gstPctSnapshot ?? '',
      outwardValue: dispatch.rateSnapshotPaise != null ? fromPaise(mulQty(dispatch.rateSnapshotPaise, dispatch.okQty)) : '',
      customerInvoiceNo: dispatch.custInvoiceNo ?? '',
      customerInvoiceDate: dispatch.custInvoiceDate ?? '',
      ...balance,
    }))
  })
}
