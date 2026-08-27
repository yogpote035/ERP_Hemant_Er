/* Replicate the MIO parse to list ERROR-level issues for a sheet. node scripts/findImportErrors.mjs */
import * as XLSX from 'xlsx'
import { readFileSync } from 'node:fs'

const FILE = process.argv[2] ?? 'C:/Users/Admin/Downloads/ROLEX RING LIMITED MIO 2025-26.xlsx'
const SHEET = process.argv[3] ?? 'ROLEX-2023&2024'
const wb = XLSX.read(readFileSync(FILE), { cellDates: false })
const rows = XLSX.utils.sheet_to_json(wb.Sheets[SHEET], { header: 1, defval: '', blankrows: false })

const str = (v) => (v == null ? '' : String(v).trim())
const intOrNull = (v) => { const s = str(v); if (!s) return null; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) ? Math.round(n) : null }
const money = (v) => { const s = str(v); if (!s) return undefined; const n = Number(s.replace(/,/g, '')); return Number.isFinite(n) && n > 0 ? n : undefined }
// header detect
const norm = (r) => r.map((c) => str(c).toLowerCase().replace(/[^a-z0-9]/g, ''))
const H = rows.findIndex((r) => { const n = norm(r); const has = (...x) => n.some((h) => h && x.some((y) => h.includes(y))); return has('challan', 'dcno') && has('partno', 'received', 'billno') })
// columns (from the known header)
const C = { challanNo: 2, challanDate: 3, partNo: 1, received: 7, billNo: 9, ok: 11, mr: 12, mf: 13, rate: 15 }
const data = rows.slice(H + 1)

let cur = null
const inwards = []
data.forEach((row, i) => {
  const challanNo = str(row[C.challanNo])
  const recv = intOrNull(row[C.received])
  if (row.every((c) => str(c) === '')) return
  if (challanNo && recv != null && recv > 0) { cur = { sheetRow: H + i + 2, challanNo, partNo: str(row[C.partNo]), recv, disp: [] }; inwards.push(cur) }
  const ok = intOrNull(row[C.ok]) ?? 0, mr = intOrNull(row[C.mr]) ?? 0, mf = intOrNull(row[C.mf]) ?? 0
  const billNo = str(row[C.billNo])
  if ((billNo || ok > 0 || mr > 0 || mf > 0) && cur) cur.disp.push({ sheetRow: H + i + 2, billNo, ok, mr, mf, rate: money(row[C.rate]) })
})

const errors = []
for (const inw of inwards) {
  const consumed = inw.disp.reduce((a, d) => a + d.ok + d.mr + d.mf, 0)
  if (consumed > inw.recv) errors.push(`row ${inw.sheetRow}: challan ${inw.challanNo} (${inw.partNo}) dispatched ${consumed} > received ${inw.recv}`)
  for (const d of inw.disp) {
    if (d.ok < 0 || d.mr < 0 || d.mf < 0) errors.push(`row ${d.sheetRow}: challan ${inw.challanNo} negative qty`)
    if (d.ok > 0 && (d.rate == null || d.rate <= 0)) errors.push(`row ${d.sheetRow}: bill ${d.billNo || '—'} on ${inw.challanNo} OK ${d.ok} but no rate`)
  }
}
console.log(`SHEET "${SHEET}"  header=row ${H + 1}  inwards=${inwards.length}`)
console.log(`ERRORS (${errors.length}):`)
errors.forEach((e) => console.log('  ', e))
