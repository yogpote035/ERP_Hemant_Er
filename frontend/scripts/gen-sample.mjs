/* Generates a sample MIO workbook for the Excel Import wizard. Run once:
 *   node scripts/gen-sample.mjs   →  public/sample/HEW-sample-MIO.xlsx
 * Uses the real 26-column MIO header (auto-detected by the importer) and
 * seeded part numbers so it imports cleanly against the demo data. */
import * as XLSX from 'xlsx'
import { mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'sample')
mkdirSync(OUT, { recursive: true })

const HEADER = [
  'Sr.No', 'Part No', 'Delivery Challan No', 'Challan Date', 'PO No', 'Batch&Heat No', 'Rate/Unit',
  'Received QTY', 'Remarks1', 'Bill No', 'Bill Date', 'SKF Dispatch Qty', 'MR', 'MF', 'Total Qty',
  'Rate/Pc', 'Total Amount', 'IGST', 'Grand Total', 'Remarks2', 'Remarks2b', 'SKF Dispatch Date',
  'Rolex Invoice No', 'Rolex Invoice Date', 'Cheque No', 'Cheque Date',
]
const row = (o) => {
  const r = new Array(26).fill('')
  for (const [k, v] of Object.entries(o)) r[Number(k)] = v
  return r
}

const data = [
  // Challan 1 — IM-6308-ALS · 10,000 received · two billed dispatches (2nd has a machine rejection)
  row({ 0: 1, 1: 'IM-6308-ALS', 2: '8202421999', 3: '2025-04-10', 4: '1190500001', 5: '1090500-SUN-60001', 6: 62, 7: 10000 }),
  row({ 1: 'IM-6308-ALS', 2: '8202421999', 9: '305/25-26', 10: '2025-04-20', 11: 6000, 15: 5.1, 21: '2025-04-18' }),
  row({ 1: 'IM-6308-ALS', 2: '8202421999', 9: '305/25-26', 11: 3800, 12: 200, 15: 5.1, 21: '2025-04-19' }),
  // Challan 2 — OM-6308-A-2RS · 5,000 received · fully dispatched on one bill
  row({ 0: 2, 1: 'OM-6308-A-2RS', 2: '8202422000', 3: '2025-04-12', 4: '1190500002', 5: '1090501-SUN-60002', 6: 64, 7: 5000 }),
  row({ 1: 'OM-6308-A-2RS', 2: '8202422000', 9: '306/25-26', 10: '2025-04-22', 11: 5000, 15: 7.95, 21: '2025-04-21' }),
  // Challan 3 — IM-6310-ALS · 8,000 received · in-house (no dispatch yet)
  row({ 0: 3, 1: 'IM-6310-ALS', 2: '8202422010', 3: '2025-04-15', 4: '1190500003', 5: '1090502-SUN-60003', 6: 66, 7: 8000 }),
]

const ws = XLSX.utils.aoa_to_sheet([HEADER, ...data])
ws['!cols'] = HEADER.map(() => ({ wch: 16 }))
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'ROLEX MIO 2025-26')
const file = join(OUT, 'HEW-sample-MIO.xlsx')
XLSX.writeFile(wb, file)
console.log('wrote', file)
