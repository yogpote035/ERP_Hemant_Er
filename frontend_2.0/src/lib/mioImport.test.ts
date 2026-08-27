import { describe, it, expect } from 'vitest'
import { autoDetectColumns, groupMioRows, summarize, type MioColumnMap } from './mioImport'

// The real 26-column MIO header.
const HEADER = [
  'Sr.No', 'Part No', 'Delivery Challan No', 'Challan Date', 'PO No', 'Batch&Heat No', 'Rate/Unit',
  'Received QTY', 'Remarks1', 'Bill No', 'Bill Date', 'SKF Dispatch Qty', 'MR', 'MF', 'Total Qty',
  'Rate/Pc', 'Total Amount', 'IGST', 'Grand Total', 'Remarks2', 'Remarks2b', 'SKF Dispatch Date',
  'Rolex Invoice No', 'Rolex Invoice Date', 'Cheque No', 'Cheque Date',
]

function mk(overrides: Record<number, unknown>): unknown[] {
  const row: unknown[] = new Array(26).fill('')
  for (const [i, v] of Object.entries(overrides)) row[Number(i)] = v
  return row
}

describe('autoDetectColumns', () => {
  it('maps the key MIO columns from the header', () => {
    const m = autoDetectColumns(HEADER)
    expect(m.partNo).toBe(1)
    expect(m.challanNo).toBe(2)
    expect(m.challanDate).toBe(3)
    expect(m.batchHeatNo).toBe(5)
    expect(m.receivedQty).toBe(7)
    expect(m.billNo).toBe(9)
    expect(m.okQty).toBe(11)
    expect(m.mrQty).toBe(12)
    expect(m.mfQty).toBe(13)
    expect(m.ratePerPc).toBe(15)
  })
})

describe('groupMioRows — the blank-received grouping', () => {
  const map: MioColumnMap = autoDetectColumns(HEADER)

  it('treats a blank-Received row with a Bill No as another dispatch on the previous challan', () => {
    const rows = [
      mk({ 1: 'IM-6308 ALS', 2: '8202304871', 3: '13.06.2023', 5: 'HEAT-1', 7: 10000, 9: '222/23-24', 10: '05.07.2023', 11: 6000, 15: 5.1 }),
      mk({ 9: '185/23-24', 10: '24.06.2023', 11: 4000, 15: 8.25 }), // blank received -> continuation
    ]
    const { inwards } = groupMioRows(rows, map)
    expect(inwards).toHaveLength(1)
    expect(inwards[0]!.challanNo).toBe('8202304871')
    expect(inwards[0]!.dispatches).toHaveLength(2)
    expect(inwards[0]!.dispatches[0]!.okQty).toBe(6000)
    expect(inwards[0]!.dispatches[1]!.okQty).toBe(4000)
    expect(inwards[0]!.dispatches.every((d) => d.kind === 'billed')).toBe(true)
  })

  it('classifies an MR/MF-only line as a rejection (no rate) and rolls up totals', () => {
    const rows = [
      mk({ 1: 'P', 2: 'CH1', 3: '01.04.2025', 5: 'H', 7: 1000, 9: 'B1', 11: 800, 15: 5 }),
      mk({ 9: 'DC15', 12: 200 }), // MR only -> rejection
    ]
    const { inwards } = groupMioRows(rows, map)
    const ds = inwards[0]!.dispatches
    expect(ds[1]!.kind).toBe('rejection')
    expect(ds[1]!.ratePaise).toBeUndefined()
    const s = summarize(inwards)
    expect(s.billedQty).toBe(800)
    expect(s.rejectionQty).toBe(200)
    expect(s.dispatchCount).toBe(2)
  })

  it('flags a dispatch row that appears before any inward challan', () => {
    const rows = [mk({ 9: 'ORPHAN', 11: 50 })]
    const { inwards, issues } = groupMioRows(rows, map)
    expect(inwards).toHaveLength(0)
    expect(issues.some((i) => i.level === 'error')).toBe(true)
  })
})
