import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from './index'
import { seedState } from '@/lib/seed'
import { values, getById } from './normalized'
import { toPaise } from '@/lib/money'
import { undo } from './commandBus'
import { CommandDeniedError, CommandValidationError } from './commands'
import type { Role } from '@/types/rbac'
import {
  runSaveInward,
  runSaveDispatch,
  runDeleteInward,
  runDeleteDispatch,
  runSaveDispatchBatch,
} from './registerCommands'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id
const billsNamed = (billNo: string) =>
  values(st().billing.invoices).filter((i) => i.billNo === billNo && i.unitId === 'u1')

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

function freshInward(challanNo = 'TEST-CH-1', qty = 1000): string {
  return runSaveInward({
    unitId: 'u1', partId: 'p1', challanNo, challanDate: '2025-04-01', batchHeatNo: 'H-1', receivedQty: qty,
  }).data.id
}

describe('saveInward', () => {
  it('creates an inward (logged + undoable) and blocks a duplicate challan', () => {
    const id = freshInward()
    expect(getById(st().inventory.inwards, id)!.receivedQty).toBe(1000)
    expect(st().system.activityLog.at(-1)?.command).toBe('saveInward')
    expect(st()._undo.length).toBeGreaterThan(0)

    expect(() =>
      runSaveInward({ unitId: 'u1', partId: 'p1', challanNo: 'TEST-CH-1', challanDate: '2025-04-02', batchHeatNo: 'H-2', receivedQty: 5 })
    ).toThrow(CommandValidationError)
  })
})

describe('saveOutwardDispatch — the make-or-break transaction', () => {
  it('writes a dispatch, snapshots GST, and creates/attaches one draft invoice per Bill No', () => {
    const id = freshInward('CH-DISP', 1000)
    const d1 = runSaveDispatch({
      inwardId: id, kind: 'billed', okQty: 600, mcRejQty: 0, mfQty: 0,
      billNo: 'TBILL-1', billDate: '2025-04-05', dispatchDate: '2025-04-05', ratePaise: toPaise(10),
    }).data.id

    const part = getById(st().masters.parts, 'p1')!
    expect(getById(st().inventory.dispatches, d1)!.gstPctSnapshot).toBe(part.gstPct)
    let bills = billsNamed('TBILL-1')
    expect(bills).toHaveLength(1)
    expect(bills[0]!.lifecycle).toBe('draft')
    expect(bills[0]!.dispatchIds).toContain(d1)

    // Second dispatch, SAME bill no → attaches to the SAME draft invoice.
    const d2 = runSaveDispatch({
      inwardId: id, kind: 'billed', okQty: 400, mcRejQty: 0, mfQty: 0,
      billNo: 'TBILL-1', billDate: '2025-04-05', ratePaise: toPaise(10),
    }).data.id
    bills = billsNamed('TBILL-1')
    expect(bills).toHaveLength(1)
    expect([...bills[0]!.dispatchIds].sort()).toEqual([d1, d2].sort())
  })

  it('rejects over-dispatch beyond the challan received qty (invariant I1)', () => {
    const id = freshInward('CH-I1', 500)
    runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 500, mcRejQty: 0, mfQty: 0, billNo: 'B', ratePaise: toPaise(5) })
    expect(() =>
      runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 1, mcRejQty: 0, mfQty: 0, billNo: 'B2', ratePaise: toPaise(5) })
    ).toThrow(CommandValidationError)
  })

  it('a rejection dispatch consumes stock but is not billed', () => {
    const id = freshInward('CH-REJ', 100)
    const d = runSaveDispatch({ inwardId: id, kind: 'rejection', okQty: 0, mcRejQty: 20, mfQty: 0, billNo: 'REJ-DC-1' }).data.id
    expect(getById(st().inventory.dispatches, d)!.rateSnapshotPaise).toBeUndefined()
    expect(values(st().billing.invoices).some((i) => i.dispatchIds.includes(d))).toBe(false)
  })

  it('requires bill no + rate for a billed dispatch', () => {
    const id = freshInward('CH-VAL', 100)
    expect(() => runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 10, mcRejQty: 0, mfQty: 0 })).toThrow(
      CommandValidationError
    )
  })

  it('undo removes the dispatch and its auto-created draft invoice', () => {
    const id = freshInward('CH-UNDO', 100)
    const d = runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 50, mcRejQty: 0, mfQty: 0, billNo: 'UNDO-BILL', ratePaise: toPaise(8) }).data.id
    expect(billsNamed('UNDO-BILL')).toHaveLength(1)
    undo()
    expect(getById(st().inventory.dispatches, d)).toBeUndefined()
    expect(billsNamed('UNDO-BILL')).toHaveLength(0)
  })
})

describe('saveOutwardDispatch batch — the multi-line outward entry', () => {
  it('saves several lines atomically: one draft invoice per bill no., one undo entry', () => {
    const id = freshInward('CH-BATCH', 1000)
    const undoBefore = st()._undo.length
    const res = runSaveDispatchBatch({
      inwardId: id,
      lines: [
        { kind: 'billed', okQty: 300, mcRejQty: 0, mfQty: 0, billNo: 'BB-1', ratePaise: toPaise(5) },
        { kind: 'billed', okQty: 200, mcRejQty: 0, mfQty: 0, billNo: 'BB-1', ratePaise: toPaise(5) },
        { kind: 'rejection', okQty: 0, mcRejQty: 40, mfQty: 0, billNo: 'DC-9' },
      ],
    })
    expect(res.data.ids).toHaveLength(3)
    // Both billed lines collapse onto a single draft invoice for BB-1.
    const bills = billsNamed('BB-1')
    expect(bills).toHaveLength(1)
    expect(bills[0]!.lifecycle).toBe('draft')
    expect([...bills[0]!.dispatchIds].sort()).toEqual([res.data.ids[0], res.data.ids[1]].sort())
    // The rejection line is on no invoice.
    expect(values(st().billing.invoices).some((i) => i.dispatchIds.includes(res.data.ids[2]!))).toBe(false)
    // Exactly ONE undo record for the whole batch.
    expect(st()._undo.length).toBe(undoBefore + 1)
  })

  it('rejects on the CUMULATIVE total even when each line fits alone (I1)', () => {
    const id = freshInward('CH-CUM', 500)
    expect(() =>
      runSaveDispatchBatch({
        inwardId: id,
        lines: [
          { kind: 'billed', okQty: 300, mcRejQty: 0, mfQty: 0, billNo: 'X1', ratePaise: toPaise(5) },
          { kind: 'billed', okQty: 300, mcRejQty: 0, mfQty: 0, billNo: 'X2', ratePaise: toPaise(5) },
        ],
      })
    ).toThrow(CommandValidationError)
    // Nothing was written.
    expect(values(st().inventory.dispatches).filter((d) => d.inwardId === id)).toHaveLength(0)
  })

  it('undo reverts the entire batch (all lines + the created draft invoice)', () => {
    const id = freshInward('CH-BUNDO', 200)
    const res = runSaveDispatchBatch({
      inwardId: id,
      lines: [{ kind: 'billed', okQty: 100, mcRejQty: 0, mfQty: 0, billNo: 'UB-1', ratePaise: toPaise(7) }],
    })
    expect(billsNamed('UB-1')).toHaveLength(1)
    undo()
    expect(res.data.ids.every((d) => getById(st().inventory.dispatches, d) === undefined)).toBe(true)
    expect(billsNamed('UB-1')).toHaveLength(0)
  })
})

describe('deletes + RBAC', () => {
  it('deleting a dispatch unlinks it and removes an emptied draft invoice', () => {
    const id = freshInward('CH-DEL', 100)
    const d1 = runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 30, mcRejQty: 0, mfQty: 0, billNo: 'DELBILL', ratePaise: toPaise(8) }).data.id
    const d2 = runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 20, mcRejQty: 0, mfQty: 0, billNo: 'DELBILL', ratePaise: toPaise(8) }).data.id
    runDeleteDispatch(d2)
    expect(billsNamed('DELBILL')[0]!.dispatchIds).toEqual([d1])
    runDeleteDispatch(d1)
    expect(billsNamed('DELBILL')).toHaveLength(0)
  })

  it('blocks deleting an inward that still has dispatches', () => {
    const id = freshInward('CH-GUARD', 100)
    runSaveDispatch({ inwardId: id, kind: 'rejection', okQty: 0, mcRejQty: 10, mfQty: 0, billNo: 'R' })
    expect(() => runDeleteInward(id)).toThrow(CommandValidationError)
  })

  it('an operator can record inward/dispatch but cannot delete them', () => {
    login(roleId('operator')) // operator: inward/dispatch = view/create/edit/export (no delete)
    const id = runSaveInward({ unitId: 'u1', partId: 'p1', challanNo: 'OP-CH', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 50 }).data.id
    const d = runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 10, mcRejQty: 0, mfQty: 0, billNo: 'OPB', ratePaise: toPaise(5) }).data.id
    expect(() => runDeleteDispatch(d)).toThrow(CommandDeniedError)
    expect(() => runDeleteInward(id)).toThrow(CommandDeniedError)
  })
})

describe('issued-invoice immutability + unit-scope on deletes (review fixes)', () => {
  it('cannot bill onto an already-issued bill no.', () => {
    const id = freshInward('CH-ISSUED', 100)
    // 255/24-25 is a SENT invoice in the seed.
    expect(() =>
      runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 10, mcRejQty: 0, mfQty: 0, billNo: '255/24-25', ratePaise: toPaise(5) })
    ).toThrow(CommandValidationError)
  })

  it('cannot edit or delete a dispatch that sits on a sent invoice', () => {
    // seed: d1 is on the sent invoice 255/24-25
    expect(() =>
      runSaveDispatch({ id: 'd1', inwardId: 'i1', kind: 'billed', okQty: 12020, mcRejQty: 0, mfQty: 0, billNo: '255/24-25', ratePaise: toPaise(5.1) })
    ).toThrow(CommandValidationError)
    expect(() => runDeleteDispatch('d1')).toThrow(CommandValidationError)
  })

  it('preserves the original GST snapshot when a billed dispatch is edited after the part GST changes', () => {
    const id = freshInward('CH-GST', 100)
    const d = runSaveDispatch({ inwardId: id, kind: 'billed', okQty: 50, mcRejQty: 0, mfQty: 0, billNo: 'GSTBILL', ratePaise: toPaise(10) }).data.id
    const snapBefore = getById(st().inventory.dispatches, d)!.gstPctSnapshot
    // Change the part's GST% (immer-frozen state ⇒ rebuild the slice, don't mutate).
    useStore.setState((s) => {
      const p = s.masters.parts.byId['p1']!
      return { masters: { ...s.masters, parts: { ...s.masters.parts, byId: { ...s.masters.parts.byId, p1: { ...p, gstPct: 18 } } } } }
    })
    runSaveDispatch({ id: d, inwardId: id, kind: 'billed', okQty: 60, mcRejQty: 0, mfQty: 0, billNo: 'GSTBILL', ratePaise: toPaise(10) })
    expect(getById(st().inventory.dispatches, d)!.gstPctSnapshot).toBe(snapBefore)
  })

  it('a manager cannot delete an inward in a unit outside their assignment', () => {
    // Insert an inward in u3 (manager is assigned u1, u2 only).
    useStore.setState((s) => {
      const inw = {
        id: 'i-u3', unitId: 'u3', partId: 'p1', challanNo: 'U3-CH', challanDate: '2025-01-01',
        batchHeatNo: 'H', receivedQty: 10, createdBy: 'admin', createdAt: '2025-01-01T00:00:00.000Z',
      }
      const coll = { byId: { ...s.inventory.inwards.byId, 'i-u3': inw }, allIds: [...s.inventory.inwards.allIds, 'i-u3'] }
      return { inventory: { ...s.inventory, inwards: coll } }
    })
    login(roleId('manager'))
    expect(() => runDeleteInward('i-u3')).toThrow(CommandValidationError)
  })
})
