import { describe, it, expect, beforeEach } from 'vitest'
import { useStore, login } from '@/store'
import { seedState } from '@/lib/seed'
import { values } from '@/store/normalized'
import type { Role } from '@/types/rbac'
import { REPORTS, reportByKey } from './reports'

const st = () => useStore.getState()
const roleId = (role: Role) => values(st().masters.users).find((u) => u.role === role)!.id

beforeEach(() => {
  useStore.setState(seedState(), true)
  login(roleId('admin'))
})

describe('report registry', () => {
  it('every report builds columns + rows without throwing', () => {
    for (const def of REPORTS) {
      const res = def.build(st(), {})
      expect(res.columns.length).toBeGreaterThan(0)
      expect(Array.isArray(res.rows)).toBe(true)
      // every row exposes a value for each column key
      for (const row of res.rows.slice(0, 3)) {
        for (const c of res.columns) expect(c.key in row).toBe(true)
      }
    }
  })

  it('billing summary lists scoped invoices with money columns', () => {
    const res = reportByKey('billing-summary')!.build(st(), {})
    expect(res.columns.map((c) => c.key)).toEqual(
      expect.arrayContaining(['billNo', 'customer', 'grand', 'outstanding'])
    )
    expect(res.rows.length).toBeGreaterThan(0)
    expect(typeof res.rows[0]!.billNo).toBe('string')
  })

  it('inward/outward register honours the date range', () => {
    const all = reportByKey('inward-outward')!.build(st(), {}).rows.length
    const future = reportByKey('inward-outward')!.build(st(), { from: '2099-01-01' }).rows.length
    expect(all).toBeGreaterThan(0)
    expect(future).toBe(0)
  })

  it('customer-wise revenue aggregates by customer (issued invoices only)', () => {
    const res = reportByKey('customer-revenue')!.build(st(), {})
    expect(res.columns[0]!.key).toBe('customer')
    // no duplicate customer rows
    const names = res.rows.map((r) => r.customer)
    expect(new Set(names).size).toBe(names.length)
  })
})
