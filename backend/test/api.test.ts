/**
 * HTTP integration tests (supertest against the real Express app). Covers auth,
 * RBAC, unit-scoping, master CRUD, and the inventory/billing write cascades.
 * State is reset to a fresh seed before each test (isolated, in a temp DB file).
 */
import { describe, it, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import request from 'supertest'

// Point the repo at a throwaway DB file BEFORE the app/config modules load.
process.env.NODE_ENV = 'test' // quiet request logging
process.env.DATA_FILE = join(tmpdir(), `hew-test-api-${process.pid}.json`)
process.env.JWT_SECRET = 'test-secret'
process.env.AUTH_RATE_MAX = '1000' // don't throttle the test suite's many logins

const { createApp } = await import('../src/app.js')
const { initRepository, replaceState } = await import('../src/db/repository.js')
const { seedState } = await import('../src/db/seed.js')
const { assertProdConfig } = await import('../src/config.js')

await initRepository()
const app = createApp()

beforeEach(async () => {
  await replaceState(seedState())
})

const tokenFor = async (email = 'admin@hew.in', password = 'demo'): Promise<string> => {
  const r = await request(app).post('/api/auth/login').send({ email, password })
  return r.body.token
}
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

describe('auth', () => {
  it('rejects a bad password and accepts valid credentials', async () => {
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'admin@hew.in', password: 'nope' })).status, 401)
    const ok = await request(app).post('/api/auth/login').send({ email: 'admin@hew.in', password: 'demo' })
    assert.equal(ok.status, 200)
    assert.ok(ok.body.token)
    assert.equal(ok.body.user.passwordHash, undefined) // never leaks the hash
  })

  it('guards /me behind a bearer token', async () => {
    assert.equal((await request(app).get('/api/auth/me')).status, 401)
    const t = await tokenFor()
    const me = await request(app).get('/api/auth/me').set(auth(t))
    assert.equal(me.status, 200)
    assert.equal(me.body.user.email, 'admin@hew.in')
  })
})

describe('RBAC + unit scope', () => {
  it('forbids an operator from creating a customer', async () => {
    const t = await tokenFor('opa@hew.in')
    const r = await request(app).post('/api/masters/customers').set(auth(t)).send({ name: 'X', gstin: '', stateCode: '27', addressLines: [] })
    assert.equal(r.status, 403)
  })

  it('scopes the parts list to the operator’s assigned units', async () => {
    const t = await tokenFor('opa@hew.in') // unit u1 only
    const r = await request(app).get('/api/masters/parts').set(auth(t))
    assert.equal(r.status, 200)
    assert.ok(r.body.data.length > 0)
    assert.ok(!r.body.data.some((p: { unitId: string }) => p.unitId === 'u2'))
  })
})

describe('masters CRUD', () => {
  it('round-trips create → update → soft-delete → reactivate', async () => {
    const t = await tokenFor()
    const created = await request(app).post('/api/masters/customers').set(auth(t)).send({ name: 'Acme', gstin: '27AAAAA0000A1Z5', stateCode: '27', addressLines: ['Pune'] })
    assert.equal(created.status, 201)
    const id = created.body.data.id

    const upd = await request(app).put(`/api/masters/customers/${id}`).set(auth(t)).send({ name: 'Acme Ltd', gstin: '27AAAAA0000A1Z5', stateCode: '27', addressLines: ['Pune'], paymentTermsDays: 30 })
    assert.equal(upd.body.data.name, 'Acme Ltd')

    const del = await request(app).delete(`/api/masters/customers/${id}`).set(auth(t))
    assert.equal(del.body.data.active, false)
    const re = await request(app).patch(`/api/masters/customers/${id}/active`).set(auth(t)).send({ active: true })
    assert.equal(re.body.data.active, true)
  })

  it('validates GSTIN structure and state but permits multiple companies to share one GSTIN', async () => {
    const t = await tokenFor()
    const malformed = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'Malformed GST Co', gstin: '27ABCDE1234F1Z', stateCode: '27', addressLines: [],
    })
    assert.equal(malformed.status, 400)

    const mismatch = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'Mismatch GST Co', gstin: '29ABCDE1234F1Z5', stateCode: '27', addressLines: [],
    })
    assert.equal(mismatch.status, 400)

    const sharedGstin = '27SHARE1234S1Z5'
    const first = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'Shared GST Company One', gstin: sharedGstin, stateCode: '27', addressLines: [],
    })
    const second = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'Shared GST Company Two', gstin: sharedGstin, stateCode: '27', addressLines: [],
    })
    assert.equal(first.status, 201)
    assert.equal(second.status, 201)
    assert.notEqual(first.body.data.id, second.body.data.id)
  })

  it('validates and normalizes an optional customer PAN', async () => {
    const t = await tokenFor()
    const malformed = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'Bad PAN Company', gstin: '27ABCDE1234F1Z5', pan: 'ABCDE123', stateCode: '27', addressLines: [],
    })
    assert.equal(malformed.status, 400)

    const created = await request(app).post('/api/masters/customers').set(auth(t)).send({
      name: 'PAN Company', gstin: '27ABCDE1234F1Z5', pan: 'abcde1234f', stateCode: '27', addressLines: [],
    })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.pan, 'ABCDE1234F')
  })
})

describe('inward lifecycle', () => {
  it('creates, edits, and enforces delete guards', async () => {
    const t = await tokenFor()
    const c = await request(app).post('/api/inward').set(auth(t)).send({ unitId: 'u1', partId: 'p1', challanNo: 'IT-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 300 })
    assert.equal(c.status, 201)
    const id = c.body.data.id

    const e = await request(app).put(`/api/inward/${id}`).set(auth(t)).send({ unitId: 'u1', partId: 'p1', challanNo: 'IT-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 800 })
    assert.equal(e.body.data.receivedQty, 800)

    // i1 has dispatches → delete blocked (409); the throwaway has none → deletable.
    assert.equal((await request(app).delete('/api/inward/i1').set(auth(t))).status, 409)
    assert.equal((await request(app).delete(`/api/inward/${id}`).set(auth(t))).status, 200)
    assert.equal((await request(app).get(`/api/inward/${id}`).set(auth(t))).status, 404)
  })
})

describe('dispatch → stock cascade', () => {
  it('numbers D/Cs by their selected financial year', async () => {
    const t = await tokenFor()
    const first = await request(app).post('/api/dispatch/next-dc').set(auth(t)).send({ date: '2025-04-01' })
    const second = await request(app).post('/api/dispatch/next-dc').set(auth(t)).send({ date: '2026-03-31' })
    const nextFy = await request(app).post('/api/dispatch/next-dc').set(auth(t)).send({ date: '2026-04-01' })
    assert.equal(first.status, 201)
    assert.equal(first.body.data.dcNo, '01/2025-26')
    assert.equal(second.body.data.dcNo, '02/2025-26')
    assert.equal(nextFy.body.data.dcNo, '01/2026-27')
  })

  it('reduces stock on dispatch and restores it on delete', async () => {
    const t = await tokenFor()
    const p6 = async () => (await request(app).get('/api/stock').set(auth(t))).body.data.find((r: { partId: string }) => r.partId === 'p6').available
    const before = await p6()
    const d = await request(app).post('/api/dispatch').set(auth(t)).send({ inwardId: 'i4', lines: [{ kind: 'billed', okQty: 100, billNo: 'IT-DC', ratePaise: 6600 }] })
    assert.equal(d.status, 201)
    assert.equal(await p6(), before - 100)
    const did = Array.isArray(d.body.data) ? d.body.data[0].id : d.body.data.id
    assert.equal((await request(app).delete(`/api/dispatch/${did}`).set(auth(t))).status, 200)
    assert.equal(await p6(), before)
  })
})

describe('payments → outstanding cascade', () => {
  it('cuts the invoice outstanding by the allocated amount', async () => {
    const t = await tokenFor()
    const out255 = async () => (await request(app).get('/api/payments/outstanding').set(auth(t))).body.data.find((r: { id: string }) => r.id === 'inv-255').outstandingPaise
    assert.equal(await out255(), 14862600)
    const r = await request(app).post('/api/payments').set(auth(t)).send({ mode: 'neft', ref: 'IT', date: '2025-04-12', amountPaise: 1000000, allocations: [{ invoiceId: 'inv-255', amountPaise: 1000000 }] })
    assert.ok(r.status === 200 || r.status === 201)
    assert.equal(await out255(), 13862600)
  })
})

const idOf = (b: { data?: { id?: string; expense?: { id?: string } } }) => b.data?.id ?? b.data?.expense?.id

describe('pagination + search (server-side)', () => {
  it('returns all rows by default but paginates on request', async () => {
    const t = await tokenFor()
    const all = await request(app).get('/api/masters/parts').set(auth(t))
    assert.equal(all.body.data.length, 13)
    assert.equal(all.body.total, 13)

    const p = await request(app).get('/api/masters/parts?page=1&pageSize=5').set(auth(t))
    assert.equal(p.body.data.length, 5)
    assert.equal(p.body.total, 13)
    assert.equal(p.body.page, 1)
    assert.equal(p.body.totalPages, 3)

    const p3 = await request(app).get('/api/masters/parts?page=3&pageSize=5').set(auth(t))
    assert.equal(p3.body.data.length, 3) // last page
  })

  it('paginates by cursor (keyset) without overlap', async () => {
    const t = await tokenFor()
    const p1 = await request(app).get('/api/inward?mode=cursor&limit=2').set(auth(t))
    assert.equal(p1.body.data.length, 2)
    assert.equal(p1.body.total, 5)
    assert.equal(p1.body.hasMore, true)
    assert.ok(p1.body.nextCursor)

    const p2 = await request(app).get(`/api/inward?mode=cursor&limit=2&cursor=${encodeURIComponent(p1.body.nextCursor)}`).set(auth(t))
    assert.equal(p2.body.data.length, 2)
    const ids1 = p1.body.data.map((r) => r.inward.id)
    const ids2 = p2.body.data.map((r) => r.inward.id)
    assert.ok(ids2.every((id) => !ids1.includes(id))) // pages don't overlap

    const p3 = await request(app).get(`/api/inward?mode=cursor&limit=2&cursor=${encodeURIComponent(p2.body.nextCursor)}`).set(auth(t))
    assert.equal(p3.body.data.length, 1) // last page (5 total)
    assert.equal(p3.body.hasMore, false)
    assert.equal(p3.body.nextCursor, null)
  })

  it('filters by search (count reflects the match, not the page)', async () => {
    const t = await tokenFor()
    const r = await request(app).get('/api/masters/parts?search=IM-6310').set(auth(t))
    assert.ok(r.body.data.every((p: { partNo: string }) => p.partNo.includes('IM-6310')))
    assert.equal(r.body.total, r.body.data.length)
    assert.ok(r.body.total >= 1 && r.body.total < 13)

    // search composes with pagination
    const inwardSearch = await request(app).get('/api/inward?search=8202421273&page=1&pageSize=10').set(auth(t))
    assert.ok(inwardSearch.body.data.some((row: { inward: { challanNo: string } }) => row.inward.challanNo === '8202421273'))
  })
})

describe('client-supplied id on create (no id divergence)', () => {
  it('adopts the client id so a later edit/delete targets the same row', async () => {
    const t = await tokenFor()
    const clientId = 'inw-client-fixed-1'
    const created = await request(app).post('/api/inward').set(auth(t)).send({ id: clientId, unitId: 'u1', partId: 'p1', challanNo: 'CID-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 100 })
    assert.equal(created.status, 201)
    assert.equal(created.body.data.id, clientId) // server adopted the id, didn't mint its own
    // a follow-up edit on that id succeeds (would 404 if the server had diverged)
    const edit = await request(app).put(`/api/inward/${clientId}`).set(auth(t)).send({ unitId: 'u1', partId: 'p1', challanNo: 'CID-1', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 150 })
    assert.equal(edit.status, 200)
    assert.equal(edit.body.data.receivedQty, 150)
  })

  it('mints a fresh id when the client id collides', async () => {
    const t = await tokenFor()
    // i1 already exists; a create reusing it must NOT overwrite it.
    const r = await request(app).post('/api/masters/customers').set(auth(t)).send({ id: 'c1', name: 'Collide Co', gstin: '27CCCCC0000C1Z5', stateCode: '27', addressLines: [] })
    assert.equal(r.status, 201)
    assert.notEqual(r.body.data.id, 'c1') // didn't clobber the seeded customer c1
  })
})

describe('edit endpoints (PUT) sync non-admin edits', () => {
  it('edits an expense and preserves recorded instalments', async () => {
    const t = await tokenFor()
    const created = await request(app).post('/api/expenses').set(auth(t)).send({ unitId: 'u1', category: 'Tooling', date: '2025-04-01', totalPaise: 100000 })
    const id = idOf(created.body)!
    await request(app).post(`/api/expenses/${id}/pay`).set(auth(t)).send({ date: '2025-04-02', amountPaise: 40000, mode: 'cash', ref: 'x' })
    const put = await request(app).put(`/api/expenses/${id}`).set(auth(t)).send({ unitId: 'u1', category: 'Consumables', date: '2025-04-01', totalPaise: 100000 })
    assert.equal(put.status, 200)
    const row = (await request(app).get('/api/expenses').set(auth(t))).body.data.find((e: { id: string }) => e.id === id)
    assert.equal(row.category, 'Consumables')
    assert.equal(row.instalments.length, 1) // edit did NOT wipe the payment
  })

  it('edits a rejection advice and recomputes the weight', async () => {
    const t = await tokenFor()
    const created = await request(app).post('/api/rejection').set(auth(t)).send({ unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'EDIT-RJ', rejDate: '2025-04-01', mrQty: 10, frQty: 0, weightBasis: 'scrap', weightPerRingMg: 100000 })
    const id = idOf(created.body)!
    assert.equal(created.body.data.totalWeightGrams, 1000)
    const put = await request(app).put(`/api/rejection/${id}`).set(auth(t)).send({ unitId: 'u1', customerId: 'c1', partId: 'p1', sourceInwardId: 'i2', rejDcNo: 'EDIT-RJ', rejDate: '2025-04-01', mrQty: 20, frQty: 0, weightBasis: 'scrap', weightPerRingMg: 100000 })
    assert.equal(put.status, 200)
    assert.equal(put.body.data.totalWeightGrams, 2000)
  })
})

describe('validation + business-rule guards (sad paths)', () => {
  it('rejects malformed bodies with 400 + detail', async () => {
    const t = await tokenFor()
    const r = await request(app).post('/api/inward').set(auth(t)).send({ unitId: 'u1', partId: 'p1' }) // missing required fields
    assert.equal(r.status, 400)
    assert.ok(Array.isArray(r.body.detail) || typeof r.body.error === 'string')
  })

  it('404s an unknown master and a missing row', async () => {
    const t = await tokenFor()
    assert.equal((await request(app).get('/api/masters/widgets').set(auth(t))).status, 404)
    assert.equal((await request(app).get('/api/masters/customers/nope').set(auth(t))).status, 404)
  })

  it('blocks a duplicate inward challan (409)', async () => {
    const t = await tokenFor()
    const dup = await request(app).post('/api/inward').set(auth(t)).send({ unitId: 'u1', partId: 'p3', challanNo: '8202421273', challanDate: '2025-04-01', batchHeatNo: 'H', receivedQty: 10 })
    assert.equal(dup.status, 409)
  })

  it('rejects over-dispatch beyond available stock (invariant I1)', async () => {
    const t = await tokenFor()
    const r = await request(app).post('/api/dispatch').set(auth(t)).send({ inwardId: 'i4', lines: [{ kind: 'billed', okQty: 999999, billNo: 'OD', ratePaise: 100 }] })
    assert.equal(r.status, 400)
  })

  it('rejects an inward edit that drops receivedQty below what was dispatched', async () => {
    const t = await tokenFor()
    const r = await request(app).put('/api/inward/i1').set(auth(t)).send({ unitId: 'u1', partId: 'p3', challanNo: '8202421273', challanDate: '2025-01-09', batchHeatNo: 'H', receivedQty: 100 })
    assert.equal(r.status, 400)
  })

  it('refuses to delete a dispatch that sits on an issued bill', async () => {
    const t = await tokenFor()
    // d1 belongs to inv-255 (lifecycle 'sent').
    assert.equal((await request(app).delete('/api/dispatch/d1').set(auth(t))).status, 400)
  })

  it('caps a payment allocation at the invoice outstanding', async () => {
    const t = await tokenFor()
    const r = await request(app).post('/api/payments').set(auth(t)).send({ mode: 'neft', ref: 'OVER', date: '2025-04-12', amountPaise: 99999999, allocations: [{ invoiceId: 'inv-255', amountPaise: 99999999 }] })
    assert.equal(r.status, 400)
  })

  it('denies a login for a deactivated user', async () => {
    const t = await tokenFor()
    await request(app).patch('/api/users/u-op1/active').set(auth(t)).send({ active: false })
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'opa@hew.in', password: 'demo' })).status, 401)
  })
})

describe('ops: health / readiness / correlation', () => {
  it('health is cheap; readiness checks the datastore; every response carries a request id', async () => {
    const h = await request(app).get('/api/health')
    assert.equal(h.status, 200)
    assert.equal(h.body.ok, true)
    assert.ok(h.headers['x-request-id'], 'X-Request-Id header set')

    const r = await request(app).get('/api/ready')
    assert.equal(r.status, 200)
    assert.equal(r.body.ready, true)
    assert.equal(r.body.db, true)
  })
})

describe('security', () => {
  it('sets helmet + rate-limit headers', async () => {
    const h = await request(app).get('/api/health')
    assert.equal(h.headers['x-content-type-options'], 'nosniff') // helmet
    const login = await request(app).post('/api/auth/login').send({ email: 'admin@hew.in', password: 'demo' })
    assert.ok(Object.keys(login.headers).some((k) => k.startsWith('ratelimit')), 'rate-limit headers present')
  })

  it('changes a password (rejects a wrong current; old stops working)', async () => {
    const t = await tokenFor()
    assert.equal((await request(app).post('/api/auth/change-password').set(auth(t)).send({ currentPassword: 'wrong', newPassword: 'newpass12' })).status, 401)
    assert.equal((await request(app).post('/api/auth/change-password').set(auth(t)).send({ currentPassword: 'demo', newPassword: 'newpass12' })).status, 200)
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'admin@hew.in', password: 'newpass12' })).status, 200)
    assert.equal((await request(app).post('/api/auth/login').send({ email: 'admin@hew.in', password: 'demo' })).status, 401)
  })

  it('rejects a stale full-state snapshot (optimistic concurrency 409)', async () => {
    const t = await tokenFor()
    const backup = await request(app).get('/api/system/backup').set(auth(t))
    const version: number = backup.body.version
    const state = backup.body.data

    // A stale baseVersion (someone else wrote since) is refused.
    const stale = await request(app).post('/api/system/backup').set(auth(t)).send({ state, baseVersion: version - 1 })
    assert.equal(stale.status, 409)
    // The current version is accepted.
    const ok = await request(app).post('/api/system/backup').set(auth(t)).send({ state, baseVersion: version })
    assert.equal(ok.status, 200)
    assert.equal(ok.body.version, version + 1)
  })

  it('prod config guard rejects unsafe settings and accepts safe ones', () => {
    assert.throws(() => assertProdConfig({ isProd: true, dbHost: '', dbUser: '', dbPassword: '', dbName: '', jwtSecret: 'dev-secret-change-me', corsOrigins: [] }))
    assert.doesNotThrow(() => assertProdConfig({ isProd: true, dbHost: 'mysql', dbUser: 'user', dbPassword: 'secret', dbName: 'app', jwtSecret: 'x'.repeat(40), corsOrigins: ['https://app'] }))
    assert.doesNotThrow(() => assertProdConfig({ isProd: false, dbHost: '', dbUser: '', dbPassword: '', dbName: '', jwtSecret: 'dev-secret-change-me', corsOrigins: [] }))
  })
})
