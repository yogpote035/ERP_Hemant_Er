import { beforeEach, describe, expect, it } from 'vitest'
import type { Inward, User } from '@/types/domain'
import { useStore, login, logout } from './index'
import { createEmptyState } from './state'
import { putEntity, values } from './normalized'
import { scopedInwards } from './scope'
import { runCommand, undo, redo, type Command } from './commandBus'
import { CommandDeniedError } from './commands'

const ISO = '2026-01-01T00:00:00.000Z'

function mkUser(over: Partial<User> & Pick<User, 'id' | 'role' | 'assignedUnitIds'>): User {
  return {
    name: over.id,
    email: `${over.id}@hew.in`,
    active: true,
    createdAt: ISO,
    ...over,
  }
}

function mkInward(id: string, unitId: string, challanNo: string, qty: number): Inward {
  return {
    id,
    unitId,
    partId: 'p1',
    challanNo,
    challanDate: '2026-01-01',
    batchHeatNo: 'H1',
    receivedQty: qty,
    createdBy: 'u-admin',
    createdAt: ISO,
  }
}

// Two trivial commands to exercise the bus.
const addInward: Command<{ inward: Inward }, { id: string }> = {
  name: 'saveInward',
  module: 'inward',
  action: 'create',
  apply(draft, input) {
    putEntity(draft.inventory.inwards, input.inward)
    return {
      result: { id: input.inward.id },
      cascade: [`inward ${input.inward.challanNo}`],
      summary: `Saved inward ${input.inward.challanNo}`,
      refs: [{ type: 'inward', id: input.inward.id }],
      unitId: input.inward.unitId,
    }
  },
}

const deleteInward: Command<{ id: string }, Record<string, never>> = {
  name: 'deleteEntity',
  module: 'inward',
  action: 'delete',
  apply(draft, input) {
    const coll = draft.inventory.inwards
    delete coll.byId[input.id]
    coll.allIds = coll.allIds.filter((x) => x !== input.id)
    return { result: {}, cascade: [], summary: 'deleted', refs: [] }
  },
}

beforeEach(() => {
  useStore.setState(createEmptyState(), true)
  const s = useStore.getState()
  putEntity(s.masters.units, {
    id: 'U1', name: 'Unit 1', code: 'U1', gstin: '27AAAAA0000A1Z5', stateCode: '27',
    addressLines: [], invoiceFormat: '{seq}/{FY}', seqPad: 3, active: true,
  })
  putEntity(s.masters.units, {
    id: 'U2', name: 'Unit 2', code: 'U2', gstin: '27BBBBB0000B1Z5', stateCode: '27',
    addressLines: [], invoiceFormat: '{seq}/{FY}', seqPad: 3, active: true,
  })
  putEntity(s.masters.users, mkUser({ id: 'u-admin', role: 'admin', assignedUnitIds: ['U1', 'U2'] }))
  putEntity(s.masters.users, mkUser({ id: 'u-op1', role: 'operator', assignedUnitIds: ['U1'] }))
  useStore.setState(s, true)
})

describe('command-bus', () => {
  it('runs, logs, and is undoable/redoable atomically', () => {
    login('u-admin')
    const res = runCommand(addInward, { inward: mkInward('i1', 'U1', 'CH-1', 4000) })
    expect(res.ok).toBe(true)
    expect(res.data.id).toBe('i1')

    let st = useStore.getState()
    expect(values(st.inventory.inwards)).toHaveLength(1)
    expect(st.system.activityLog).toHaveLength(1)
    expect(st.system.activityLog[0]?.summary).toBe('Saved inward CH-1')
    expect(st._undo).toHaveLength(1)

    undo()
    st = useStore.getState()
    expect(values(st.inventory.inwards)).toHaveLength(0)
    expect(st.system.activityLog).toHaveLength(0)
    expect(st._undo).toHaveLength(0)
    expect(st._redo).toHaveLength(1)

    redo()
    st = useStore.getState()
    expect(values(st.inventory.inwards)).toHaveLength(1)
    expect(st._undo).toHaveLength(1)
  })

  it('denies a command the actor lacks permission for, mutating nothing', () => {
    login('u-op1')
    const before = useStore.getState()
    runCommand(addInward, { inward: mkInward('i9', 'U1', 'CH-9', 100) })
    // operator CAN create, so this one succeeds; delete must be denied:
    expect(() => runCommand(deleteInward, { id: 'i9' })).toThrow(CommandDeniedError)
    const after = useStore.getState()
    expect(values(after.inventory.inwards).map((i) => i.id)).toContain('i9')
    void before
  })
})

describe('unit-scope choke point', () => {
  it('an operator cannot see another unit’s inwards even with mixed data', () => {
    const s = useStore.getState()
    putEntity(s.inventory.inwards, mkInward('a', 'U1', 'CH-A', 10))
    putEntity(s.inventory.inwards, mkInward('b', 'U2', 'CH-B', 20))
    useStore.setState(s, true)

    login('u-op1') // operator, U1 only
    const visible = scopedInwards(useStore.getState()).map((i) => i.id)
    expect(visible).toEqual(['a'])

    login('u-admin') // admin + ALL
    useStore.setState((x) => ({ session: { ...x.session, currentUnitId: 'ALL' } }))
    expect(scopedInwards(useStore.getState()).map((i) => i.id).sort()).toEqual(['a', 'b'])

    logout()
    expect(scopedInwards(useStore.getState())).toHaveLength(0)
  })
})
