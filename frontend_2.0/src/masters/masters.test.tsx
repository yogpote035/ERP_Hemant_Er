import { describe, it, expect, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { useStore, login } from '@/store'
import { seedState } from '@/lib/seed'
import { values } from '@/store/normalized'
import { CommandDeniedError, CommandValidationError } from '@/store/commands'
import type { Role } from '@/types/rbac'
import { ALL_SPECS } from './registry'
import { EntityManager } from './EntityManager'

const spec = (key: string) => ALL_SPECS.find((s) => s.key === key)!
const roleId = (role: Role) => values(useStore.getState().masters.users).find((u) => u.role === role)!.id

beforeEach(() => {
  useStore.setState(seedState(), true)
})

describe('master commands', () => {
  it('creates, updates, soft-deletes and reactivates a customer (admin)', () => {
    login(roleId('admin'))
    const customer = spec('customer')
    const before = values(useStore.getState().masters.customers).length

    const res = customer.save(
      { name: 'Acme Co', gstin: '27ABCDE1234F1Z5', stateCode: '27', paymentTermsDays: 30, addressLines: 'L1\nL2' },
      null
    )
    expect(res.ok).toBe(true)
    const created = useStore.getState().masters.customers.byId[res.data.id]!
    expect(values(useStore.getState().masters.customers)).toHaveLength(before + 1)
    expect(created.addressLines).toEqual(['L1', 'L2'])
    expect(created.gstin).toBe('27ABCDE1234F1Z5')
    expect(created.active).toBe(true)
    expect(useStore.getState().system.activityLog.at(-1)?.command).toBe('saveMaster')

    customer.save({ name: 'Acme Corp', gstin: created.gstin, stateCode: '27', paymentTermsDays: 45 }, created)
    const updated = useStore.getState().masters.customers.byId[created.id]!
    expect(updated.name).toBe('Acme Corp')
    expect(updated.paymentTermsDays).toBe(45)

    customer.remove(updated) // soft delete
    expect(useStore.getState().masters.customers.byId[created.id]!.active).toBe(false)
    customer.setActive(updated, true)
    expect(useStore.getState().masters.customers.byId[created.id]!.active).toBe(true)
  })

  it('hard-deletes a rate and converts rupees → paise', () => {
    login(roleId('admin'))
    const rm = spec('rmRate')
    const partId = values(useStore.getState().masters.parts)[0]!.id
    const res = rm.save({ partId, rate: 12.5, effectiveFrom: '2025-04-01' }, null)
    const id = res.data.id
    expect(useStore.getState().masters.rmRates.byId[id]!.ratePaise).toBe(1250)
    rm.remove(useStore.getState().masters.rmRates.byId[id]!)
    expect(useStore.getState().masters.rmRates.byId[id]).toBeUndefined()
  })

  it('validates inside the command — bad GSTIN rejected, nothing mutated', () => {
    login(roleId('admin'))
    const customer = spec('customer')
    const before = values(useStore.getState().masters.customers).length
    expect(() => customer.save({ name: 'X', gstin: 'TOO-SHORT', stateCode: '27' }, null)).toThrow(
      CommandValidationError
    )
    expect(values(useStore.getState().masters.customers)).toHaveLength(before)
  })

  it('RBAC: operator cannot create masters; manager can create but not delete', () => {
    const customer = spec('customer')

    login(roleId('operator')) // masters = ['view'] only
    expect(() => customer.save({ name: 'Nope', gstin: '27ABCDE1234F1Z5', stateCode: '27' }, null)).toThrow(
      CommandDeniedError
    )

    login(roleId('manager')) // masters = ['view','create','edit'] — no delete
    const r = customer.save({ name: 'Mgr Co', gstin: '27ABCDE1234F1Z5', stateCode: '27' }, null)
    const created = useStore.getState().masters.customers.byId[r.data.id]!
    expect(() => customer.remove(created)).toThrow(CommandDeniedError)
  })
})

describe('command-bus guards (review fixes)', () => {
  it('enforces writable-unit membership: a manager cannot write a part into an unassigned unit', () => {
    login(roleId('manager')) // seed manager is assigned u1, u2
    const part = spec('part')
    const partValues = {
      partNo: 'X-1', materialCode: 'MC-1', uom: 'NOS', hsnSac: '7326', gstPct: '12',
      finishWtG: 1, scrapWtG: 0.1, avgQtyPerBox: 100,
    }
    // u3 is outside the manager's assigned units → rejected (zero mutation).
    expect(() => part.save({ ...partValues, unitId: 'u3' }, null)).toThrow(CommandValidationError)
    // u1 is assigned → allowed.
    expect(part.save({ ...partValues, unitId: 'u1' }, null).ok).toBe(true)
  })

  it('rejects an opening whose part is in another unit, and enforces ONE opening per (unit, part)', () => {
    login(roleId('admin'))
    const opening = spec('opening')
    const st = useStore.getState()
    // a part that has no opening yet (only p6/p9 are seeded)
    const freshPart = values(st.masters.parts).find(
      (p) => !values(st.masters.stockOpenings).some((o) => o.partId === p.id && o.unitId === p.unitId)
    )!
    const otherUnit = st.masters.units.allIds.find((id) => id !== freshPart.unitId)!
    // wrong unit → rejected
    expect(() =>
      opening.save({ unitId: otherUnit, partId: freshPart.id, fy: '24-25', openingQty: 10, asOfDate: '2024-04-01' }, null)
    ).toThrow(CommandValidationError)
    // first opening for a matching unit → accepted
    const r = opening.save({ unitId: freshPart.unitId, partId: freshPart.id, fy: '24-25', openingQty: 10, asOfDate: '2024-04-01' }, null)
    expect(r.ok).toBe(true)
    // a SECOND opening for the same (unit, part) — even a different FY — is rejected so
    // lifetime-cumulative stock can't double-count the carry-forward.
    expect(() =>
      opening.save({ unitId: freshPart.unitId, partId: freshPart.id, fy: '25-26', openingQty: 5, asOfDate: '2025-04-01' }, null)
    ).toThrow(CommandValidationError)
    // editing the existing opening row in place is still allowed (excludes self)
    expect(opening.save({ unitId: freshPart.unitId, partId: freshPart.id, fy: '24-25', openingQty: 20, asOfDate: '2024-04-01' }, r.data).ok).toBe(true)
  })

  it('deactivation requires delete: a manager can reactivate (edit) but not deactivate (delete)', () => {
    login(roleId('manager'))
    const customer = spec('customer')
    const r = customer.save({ name: 'Toggle Co', gstin: '27ABCDE1234F1Z5', stateCode: '27' }, null)
    const created = useStore.getState().masters.customers.byId[r.data.id]!
    expect(() => customer.setActive(created, false)).toThrow(CommandDeniedError) // deactivate → 'delete'
    expect(() => customer.setActive(created, true)).not.toThrow() // reactivate → 'edit'
  })

  it('rejects malformed or state-mismatched GSTINs but allows companies to share a GSTIN', () => {
    login(roleId('admin'))
    const customer = spec('customer')
    // malformed GSTIN
    expect(() => customer.save({ name: 'Bad', gstin: '27ABCDE1234F1Z', stateCode: '27' }, null)).toThrow(CommandValidationError)
    // GSTIN leading digits (29) disagree with stateCode (27)
    expect(() => customer.save({ name: 'Mismatch', gstin: '29ABCDE1234F1Z5', stateCode: '27' }, null)).toThrow(CommandValidationError)
    // Separate company/customer records may legitimately use the same GST registration.
    customer.save({ name: 'First', gstin: '27ZZZZZ1234F1Z5', stateCode: '27' }, null)
    expect(() => customer.save({ name: 'Second', gstin: '27ZZZZZ1234F1Z5', stateCode: '27' }, null)).not.toThrow()
  })

  it('enforces part-number uniqueness within a unit', () => {
    login(roleId('admin'))
    const part = spec('part')
    const base = { materialCode: 'M1', unitId: 'u1', uom: 'NOS', hsnSac: '7318', gstPct: '18', finishWtG: 1, scrapWtG: 0.1, avgQtyPerBox: 100 }
    part.save({ ...base, partNo: 'UNIQ-1' }, null)
    expect(() => part.save({ ...base, partNo: 'uniq-1' }, null)).toThrow(CommandValidationError) // case-insensitive dup
    // same part no. in a DIFFERENT unit is allowed
    expect(part.save({ ...base, partNo: 'UNIQ-1', unitId: 'u2' }, null).ok).toBe(true)
  })
})

describe('EntityManager rendering', () => {
  it('shows the scoped list with seeded rows + a New button for admin', () => {
    login(roleId('admin'))
    render(<EntityManager spec={spec('customer')} />)
    expect(screen.getByText('Rolex Rings Limited')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /new customer/i })).toBeInTheDocument()
  })
})
