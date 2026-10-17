import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values } from './normalized'
import { toPaise } from '@/lib/money'
import { undo } from './commandBus'
import { CommandValidationError } from './commands'
import type { Role } from '@/types/rbac'
import type { ParsedInward, ParsedDispatch } from '@/lib/mioImport'
import { runImportMio, previewImportIssues } from './importCommands'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const u1Part = () => values(st().masters.parts).find((p) => p.unitId === 'u1')!

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

let _r = 0
function disp(p: Partial<ParsedDispatch>): ParsedDispatch {
  const ok = p.okQty ?? 0
  return {
    rowIndex: _r++,
    okQty: ok,
    mrQty: p.mrQty ?? 0,
    mfQty: p.mfQty ?? 0,
    shinLineQty: p.shinLineQty ?? 0,
    crackQty: p.crackQty ?? 0,
    chipOffQty: p.chipOffQty ?? 0,
    forgReturnQty: p.forgReturnQty ?? 0,
    raiiQty: p.raiiQty ?? 0,
    shortQty: p.shortQty ?? 0,
    otherQty: p.otherQty ?? 0,
    billNo: p.billNo,
    ratePaise: p.ratePaise,
    kind: p.kind ?? (ok > 0 ? 'billed' : 'rejection'),
    ...p,
  }
}
function inward(partNo: string, challanNo: string, recv: number, dispatches: ParsedDispatch[], batchHeatNo = 'H'): ParsedInward {
  return { rowIndex: _r++, challanNo, challanDate: '2025-04-01', partNo, batchHeatNo, receivedQty: recv, dispatches }
}

describe('runImportMio — atomic bulk ingest', () => {
  it('imports the same challan number as separate inwards when heat numbers differ', () => {
    const partNo = u1Part().partNo
    const result = runImportMio({
      unitId: 'u1',
      inwards: [
        inward(partNo, 'MULTI-HEAT-DC', 100, [], 'HEAT-A'),
        inward(partNo, 'MULTI-HEAT-DC', 200, [], 'HEAT-B'),
      ],
    })
    const rows = values(st().inventory.inwards).filter((row) => row.challanNo === 'MULTI-HEAT-DC')
    expect(result.data.inwards).toBe(2)
    expect(rows.map((row) => row.batchHeatNo).sort()).toEqual(['HEAT-A', 'HEAT-B'])
  })

  it('inserts inwards + uniquely numbered dispatches + draft invoices, all undoable in one step', () => {
    const partNo = u1Part().partNo
    const undoBefore = st()._undo.length
    const res = runImportMio({
      unitId: 'u1',
      inwards: [
        inward(partNo, 'IMP-CH-1', 1000, [
          disp({ billNo: 'IMPB-1', okQty: 600, ratePaise: toPaise(5) }),
          disp({ billNo: 'IMPB-2', okQty: 400, ratePaise: toPaise(5) }),
        ]),
        inward(partNo, 'IMP-CH-2', 200, [disp({ billNo: 'DC9', mrQty: 50 })]),
      ],
    })
    expect(res.data.inwards).toBe(2)
    expect(res.data.dispatches).toBe(3)
    expect(res.data.invoices).toBe(2)
    const inv = values(st().billing.invoices).filter((i) => i.billNo === 'IMPB-1' && i.unitId === 'u1')
    expect(inv).toHaveLength(1)
    expect(inv[0]!.dispatchIds).toHaveLength(1)
    expect(inv[0]!.lifecycle).toBe('draft')
    expect(st()._undo.length).toBe(undoBefore + 1)

    undo()
    expect(values(st().inventory.inwards).some((i) => i.challanNo === 'IMP-CH-1')).toBe(false)
    expect(values(st().billing.invoices).some((i) => i.billNo === 'IMPB-1')).toBe(false)
  })

  it('imports every rejection category and counts each one against stock', () => {
    const part = u1Part()
    const before = values(st().inventory.dispatches).filter((d) => d.inwardId === 'i2').length
    const result = runImportMio({
      unitId: 'u1',
      inwards: [inward(part.partNo, 'IMP-REJECTION-BREAKDOWN', 100, [disp({
        billNo: 'IMP-REJ-DC', mrQty: 1, mfQty: 2, shinLineQty: 3, crackQty: 4,
        chipOffQty: 5, forgReturnQty: 6, raiiQty: 7, shortQty: 8, otherQty: 9,
      })])],
    })
    expect(result.data.dispatches).toBe(1)
    const importedInward = values(st().inventory.inwards).find((row) => row.challanNo === 'IMP-REJECTION-BREAKDOWN')!
    const saved = values(st().inventory.dispatches).find((row) => row.inwardId === importedInward.id)!
    expect(saved).toMatchObject({
      mcRejQty: 1, mfQty: 2, shinLineQty: 3, crackQty: 4, chipOffQty: 5,
      forgReturnQty: 6, raiiQty: 7, shortQty: 8, otherQty: 9,
    })
    expect(values(st().inventory.dispatches).filter((d) => d.inwardId === 'i2')).toHaveLength(before)
  })

  it('allows a rejection-only row without an outward D/C number', () => {
    const part = u1Part()
    const input = inward(part.partNo, 'IMP-REJECTION-NO-DC', 20, [disp({ mrQty: 20, billNo: undefined })])
    const issues = previewImportIssues(st(), { unitId: 'u1', inwards: [input] })
    expect(issues.some((issue) => issue.level === 'error')).toBe(false)

    const result = runImportMio({ unitId: 'u1', inwards: [input] })
    expect(result.data.dispatches).toBe(1)
    const imported = values(st().inventory.inwards).find((row) => row.challanNo === 'IMP-REJECTION-NO-DC')!
    const rejection = values(st().inventory.dispatches).find((row) => row.inwardId === imported.id)!
    expect(rejection.kind).toBe('rejection')
    expect(rejection.billNo).toBeUndefined()
  })

  it('blocks an unknown part and an over-dispatched challan', () => {
    const partNo = u1Part().partNo
    expect(() => runImportMio({ unitId: 'u1', inwards: [inward('NOPE-PART', 'X1', 100, [])] })).toThrow(CommandValidationError)
    expect(() =>
      runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'X2', 100, [disp({ billNo: 'B', okQty: 250, ratePaise: toPaise(5) })])] })
    ).toThrow(CommandValidationError)
  })

  it('reuses an existing inward and appends a new uniquely numbered outward', () => {
    const partNo = u1Part().partNo
    runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'DUP-CH', 100, [])] })
    const input = inward(partNo, 'DUP-CH', 100, [disp({ billNo: 'NEW-DC-1', okQty: 25, ratePaise: toPaise(5) })])
    const issues = previewImportIssues(st(), { unitId: 'u1', inwards: [input] })
    expect(issues.some((i) => i.level === 'warn' && /will be reused/.test(i.message))).toBe(true)
    expect(issues.some((i) => i.level === 'error')).toBe(false)
    const result = runImportMio({ unitId: 'u1', inwards: [input] })
    expect(result.data.inwards).toBe(0)
    expect(result.data.reusedInwards).toBe(1)
    expect(result.data.dispatches).toBe(1)
  })

  it('blocks a negative dispatch quantity and a non-positive received qty (import bypasses the manual guards)', () => {
    const partNo = u1Part().partNo
    expect(() =>
      runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'NEG-1', 100, [disp({ billNo: 'B', okQty: 10, mrQty: -5, ratePaise: toPaise(5) })])] })
    ).toThrow(CommandValidationError)
    expect(() =>
      runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'ZERO-RX', 0, [])] })
    ).toThrow(CommandValidationError)
  })
})
