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
    billNo: p.billNo,
    ratePaise: p.ratePaise,
    kind: p.kind ?? (ok > 0 ? 'billed' : 'rejection'),
    ...p,
  }
}
function inward(partNo: string, challanNo: string, recv: number, dispatches: ParsedDispatch[]): ParsedInward {
  return { rowIndex: _r++, challanNo, challanDate: '2025-04-01', partNo, batchHeatNo: 'H', receivedQty: recv, dispatches }
}

describe('runImportMio — atomic bulk ingest', () => {
  it('inserts inwards + dispatches + one draft invoice per bill, all undoable in one step', () => {
    const partNo = u1Part().partNo
    const undoBefore = st()._undo.length
    const res = runImportMio({
      unitId: 'u1',
      inwards: [
        inward(partNo, 'IMP-CH-1', 1000, [
          disp({ billNo: 'IMPB-1', okQty: 600, ratePaise: toPaise(5) }),
          disp({ billNo: 'IMPB-1', okQty: 400, ratePaise: toPaise(5) }),
        ]),
        inward(partNo, 'IMP-CH-2', 200, [disp({ billNo: 'DC9', mrQty: 50 })]),
      ],
    })
    expect(res.data.inwards).toBe(2)
    expect(res.data.dispatches).toBe(3)
    expect(res.data.invoices).toBe(1)
    // The two IMPB-1 lines collapse onto one draft invoice.
    const inv = values(st().billing.invoices).filter((i) => i.billNo === 'IMPB-1' && i.unitId === 'u1')
    expect(inv).toHaveLength(1)
    expect(inv[0]!.dispatchIds).toHaveLength(2)
    expect(inv[0]!.lifecycle).toBe('draft')
    expect(st()._undo.length).toBe(undoBefore + 1)

    undo()
    expect(values(st().inventory.inwards).some((i) => i.challanNo === 'IMP-CH-1')).toBe(false)
    expect(values(st().billing.invoices).some((i) => i.billNo === 'IMPB-1')).toBe(false)
  })

  it('blocks an unknown part and an over-dispatched challan', () => {
    const partNo = u1Part().partNo
    expect(() => runImportMio({ unitId: 'u1', inwards: [inward('NOPE-PART', 'X1', 100, [])] })).toThrow(CommandValidationError)
    expect(() =>
      runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'X2', 100, [disp({ billNo: 'B', okQty: 250, ratePaise: toPaise(5) })])] })
    ).toThrow(CommandValidationError)
  })

  it('previewImportIssues reports a duplicate challan against existing data', () => {
    const partNo = u1Part().partNo
    runImportMio({ unitId: 'u1', inwards: [inward(partNo, 'DUP-CH', 100, [])] })
    const issues = previewImportIssues(st(), { unitId: 'u1', inwards: [inward(partNo, 'DUP-CH', 100, [])] })
    expect(issues.some((i) => i.level === 'error' && /already exists/.test(i.message))).toBe(true)
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
