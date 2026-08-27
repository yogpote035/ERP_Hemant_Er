/* Verify API-mode WRITE-THROUGH: create a record in the UI, confirm it persisted
   to the backend. Requires backend :4000 + Vite :5173 (VITE_API_BASE set).
   Usage: node scripts/writeThroughE2E.mjs */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const APP = process.env.BASE ?? 'http://localhost:5173'
const API = process.env.API ?? 'http://localhost:4000/api'
const MARK = 'WT-Sync Customer'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function apiAdminToken() {
  const r = await fetch(API + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'admin@hew.in', password: 'demo' }) })
  return (await r.json()).token
}
async function backendCustomers(token) {
  const r = await fetch(API + '/masters/customers', { headers: { authorization: `Bearer ${token}` } })
  return (await r.json()).data ?? []
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const apiCalls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')) })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page) // admin → API login + hydrate + installWriteThrough

  // sanity: not present before
  const tok = await apiAdminToken()
  const before = await backendCustomers(tok)
  log(!before.some((c) => c.name === MARK), 'customer absent on backend before create')

  // Create a customer through the UI.
  await navTo(page, '/customers')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /New Customer/i }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel(/Customer name/i).fill(MARK)
  await page.getByLabel(/GSTIN/i).fill('27ZZZZZ0000Z1Z9')
  await page.getByLabel(/State code/i).fill('27')
  await page.getByRole('button', { name: /Create customer|Save/i }).first().click()
  await page.waitForTimeout(1500) // let the module POST land

  log(apiCalls.some((c) => c.includes('POST /api/masters/customers')), 'admin write hit the MODULE endpoint (POST /masters/customers)', apiCalls.filter((c) => c.includes('masters/customers')).slice(-1)[0] ?? '')
  log(!apiCalls.some((c) => c.includes('/api/system/backup')), 'admin write did NOT use the /system/backup catch-all')

  // Verify persisted on the backend via a fresh request.
  const after = await backendCustomers(tok)
  const found = after.find((c) => c.name === MARK)
  log(!!found && found.stateCode === '27', 'customer PERSISTED to backend after UI create', found ? found.id : 'not found')

  // cleanup
  await fetch(API + '/system/reset-demo', { method: 'POST', headers: { authorization: `Bearer ${tok}` } })

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
