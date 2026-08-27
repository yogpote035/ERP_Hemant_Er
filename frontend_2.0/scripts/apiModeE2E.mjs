/* Verify API-mode wiring end-to-end. Requires backend on :4000 and Vite on :5173
   started with VITE_API_BASE=http://localhost:4000/api.
   Usage: BASE=http://localhost:5173 node scripts/apiModeE2E.mjs */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })

  // Capture API calls to prove the network path is real.
  const apiCalls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) apiCalls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')) })

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })

  await signIn(page) // admin@hew.in / demo — in API mode this POSTs /auth/login + hydrates

  const token = await page.evaluate(() => localStorage.getItem('hew_api_token'))
  log(!!token, 'API login set a bearer token in localStorage (proves API path ran)')
  log(apiCalls.some((c) => c.includes('POST /api/auth/login')), 'POST /api/auth/login was called', apiCalls.find((c) => c.includes('auth/login')) ?? '')
  log(apiCalls.some((c) => c.includes('/api/system/backup')), 'GET /api/system/backup hydrated the store')

  // Stock view should render backend-sourced rows.
  await navTo(page, '/inventory')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Stock View/i }).first().click().catch(() => {})
  await page.waitForTimeout(500)
  const stockText = await page.locator('table').first().innerText().catch(() => '')
  log(/IM-6310-ALS|OM-6311-2RS|IM-6308/.test(stockText), 'Stock View shows hydrated backend parts')

  // Billing should show the seeded sent invoices with real money.
  await navTo(page, '/billing')
  await page.waitForTimeout(600)
  const billText = await page.locator('body').innerText()
  log(/254\/24-25|255\/24-25/.test(billText), 'Billing shows seeded invoice numbers')

  console.log(`\n${pass} passed, ${fail} failed`)
  console.log('sample API calls:', apiCalls.slice(0, 6).join(' | '))
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
