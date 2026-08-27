/* Inspect a workbook's sheets/headers/sample rows. node scripts/inspectXlsx.mjs "<path>" */
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const path = process.argv[2] ?? 'C:/Users/Admin/Downloads/ROLEX RING LIMITED MIO 2025-26.xlsx'
const wb = XLSX.read(readFileSync(path), { cellDates: true })
console.log('FILE:', path)
console.log('SHEETS:', wb.SheetNames.join(' | '))
for (const name of wb.SheetNames) {
  const ws = wb.Sheets[name]
  const rows = XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false, defval: '' })
  const ref = ws['!ref'] ?? '(empty)'
  console.log(`\n===== SHEET "${name}"  range=${ref}  rows=${rows.length} =====`)
  // Print the first ~8 non-empty rows so we can see the header band + sample data.
  const shown = rows.slice(0, 8)
  shown.forEach((r, i) => {
    const cells = r.map((c) => (c instanceof Date ? c.toISOString().slice(0, 10) : String(c))).map((s) => s.length > 18 ? s.slice(0, 17) + '…' : s)
    console.log(`  [${i}] ${cells.join(' | ')}`)
  })
  if (rows.length > 8) console.log(`  … (${rows.length - 8} more rows)`)
}
