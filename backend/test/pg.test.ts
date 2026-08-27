/**
 * Postgres-backed durability test (requires reachable PostgreSQL on :5433 by
 * default). Proves writes are transactional and survive a
 * process restart by re-loading the state from PG. Opt-in: `npm run test:pg`.
 */
import { describe, it, before, after } from 'node:test'
import assert from 'node:assert/strict'
import request from 'supertest'

// Use a DEDICATED test database — this suite truncates/reseeds, so it must never
// touch the dev/demo `hew_erp` data. Override with PG_TEST_URL if needed.
process.env.NODE_ENV = 'test'
process.env.DATABASE_URL = process.env.PG_TEST_URL || 'postgres://hew:hew@localhost:5433/hew_erp_test'
process.env.JWT_SECRET = 'pg-test-secret'

const repo = await import('../src/db/repository.js')
const { createApp } = await import('../src/app.js')
const { seedState } = await import('../src/db/seed.js')

let app = createApp()

const tokenFor = async (email = 'admin@hew.in', password = 'demo') =>
  (await request(app).post('/api/auth/login').send({ email, password })).body.token as string
const auth = (t: string) => ({ Authorization: `Bearer ${t}` })

before(async () => {
  await repo.initRepository()
  await repo.replaceState(seedState()) // clean, known baseline in PG
  app = createApp()
})
after(async () => {
  await repo.closeRepository()
})

describe('Postgres persistence', () => {
  it('persists writes transactionally and reloads them after a restart', async () => {
    const t = await tokenFor()

    // 1. mutate across several modules.
    const cust = await request(app).post('/api/masters/customers').set(auth(t)).send({ name: 'PG Durable Co', gstin: '27PGPGP0000P1Z5', stateCode: '27', addressLines: ['Pune'] })
    assert.equal(cust.status, 201)
    const custId = cust.body.data.id

    const p6Before = (await request(app).get('/api/stock').set(auth(t))).body.data.find((r: { partId: string }) => r.partId === 'p6').available
    const disp = await request(app).post('/api/dispatch').set(auth(t)).send({ inwardId: 'i4', lines: [{ kind: 'billed', okQty: 100, billNo: 'PG-DC', ratePaise: 6600 }] })
    assert.equal(disp.status, 201)

    await request(app).post('/api/payments').set(auth(t)).send({ mode: 'neft', ref: 'PG', date: '2025-04-12', amountPaise: 1000000, allocations: [{ invoiceId: 'inv-255', amountPaise: 1000000 }] })

    // 2. simulate a restart: drop the in-memory state + driver, re-open from PG.
    await repo.closeRepository()
    await repo.initRepository()
    app = createApp()

    // 3. everything must still be there, loaded from Postgres.
    const t2 = await tokenFor()
    const customers = (await request(app).get('/api/masters/customers').set(auth(t2))).body.data
    assert.ok(customers.some((c: { id: string }) => c.id === custId), 'customer survived restart')

    const p6After = (await request(app).get('/api/stock').set(auth(t2))).body.data.find((r: { partId: string }) => r.partId === 'p6').available
    assert.equal(p6After, p6Before - 100, 'dispatch/stock survived restart')

    const out255 = (await request(app).get('/api/payments/outstanding').set(auth(t2))).body.data.find((r: { id: string }) => r.id === 'inv-255').outstandingPaise
    assert.equal(out255, 13862600, 'payment survived restart')
  })

  it('paginates masters with REAL SQL (LIMIT/OFFSET + keyset cursor)', async () => {
    const t = await tokenFor()
    // offset page from Postgres (not an in-memory slice)
    const p2 = await request(app).get('/api/masters/parts?page=2&pageSize=5').set(auth(t))
    assert.equal(p2.status, 200)
    assert.equal(p2.body.data.length, 5)
    assert.equal(p2.body.total, 13)
    assert.equal(p2.body.page, 2)
    assert.equal(p2.body.totalPages, 3)

    // keyset cursor from Postgres, no overlap
    const c1 = await request(app).get('/api/masters/parts?mode=cursor&limit=5').set(auth(t))
    assert.equal(c1.body.data.length, 5)
    assert.ok(c1.body.nextCursor)
    const c2 = await request(app).get(`/api/masters/parts?mode=cursor&limit=5&cursor=${encodeURIComponent(c1.body.nextCursor)}`).set(auth(t))
    const ids1 = new Set(c1.body.data.map((r) => r.id))
    assert.ok(c2.body.data.every((r) => !ids1.has(r.id)))

    // server-side search hits Postgres too
    const s = await request(app).get('/api/masters/parts?page=1&pageSize=50&search=IM-6310').set(auth(t))
    assert.ok(s.body.data.length >= 1 && s.body.data.every((p) => p.partNo.includes('IM-6310')))
  })

  it('reset-demo truncates and reseeds in Postgres', async () => {
    const t = await tokenFor()
    await request(app).post('/api/masters/customers').set(auth(t)).send({ name: 'To Be Wiped', gstin: '27WIPE00000W1Z5', stateCode: '27', addressLines: [] })
    await request(app).post('/api/system/reset-demo').set(auth(t))
    // reload from PG and confirm the extra row is gone, seed is back.
    await repo.closeRepository()
    await repo.initRepository()
    app = createApp()
    const t2 = await tokenFor()
    const customers = (await request(app).get('/api/masters/customers').set(auth(t2))).body.data
    assert.ok(!customers.some((c: { name: string }) => c.name === 'To Be Wiped'))
    assert.equal(customers.length, 3) // seed has 3 customers
  })
})
