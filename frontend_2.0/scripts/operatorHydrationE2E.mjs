/* Verify NON-ADMIN (operator) hydration via scoped module GET endpoints.
   Requires backend :4000 + Vite :5173 (VITE_API_BASE set).
   Usage: node scripts/operatorHydrationE2E.mjs */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const APP = process.env.BASE ?? 'http://localhost:5173'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const apiCalls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]) })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  // Operator A — assigned to unit u1 only.
  await signIn(page, 'opa@hew.in', 'demo')

  log(!!(await page.evaluate(() => localStorage.getItem('hew_api_token'))), 'operator got a bearer token')
  log(apiCalls.some((c) => c === 'GET /api/inward') && apiCalls.some((c) => c === 'GET /api/masters/parts'), 'hydrated via module GET endpoints', apiCalls.filter((c) => c.startsWith('GET /api/')).slice(0, 4).join(' | '))
  log(!apiCalls.some((c) => c.includes('/api/system/backup')), 'did NOT call the admin-only /system/backup')

  // Raw Material Master should show this operator's unit (u1) parts, not u2's.
  await navTo(page, '/materials')
  await page.waitForTimeout(600)
  const txt = await page.locator('body').innerText()
  log(/IM-6310-ALS|OM-6311-2RS/.test(txt), 'operator sees u1 backend parts')
  log(!/DM-1001|DM-1002/.test(txt), 'operator does NOT see u2-only parts (scoped hydration)')

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
