/* Verify the Stock view is genuinely server-driven in API mode (fetches a page from
   GET /stock + KPIs from GET /stock/summary). Requires backend :4000 + Vite :5173. */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const APP = process.env.BASE ?? 'http://localhost:5173'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const calls = []
  page.on('request', (r) => { if (r.url().includes('/api/stock')) calls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '')) })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page) // admin

  await navTo(page, '/inventory')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Stock View/i }).first().click().catch(() => {})
  await page.waitForTimeout(900)

  log(calls.some((c) => /GET \/api\/stock\?.*mode=cursor/.test(c)), 'table fetched a page via cursor (GET /api/stock?mode=cursor)', calls.find((c) => /stock\?/.test(c)) ?? '')
  log(calls.some((c) => c.includes('/api/stock/summary')), 'KPIs fetched from GET /api/stock/summary')

  const body = await page.locator('body').innerText()
  log(/IM-6310-ALS|OM-6311-2RS|IM-6308/.test(body), 'server rows rendered')
  log(/Total Stock Value/i.test(body) && /₹/.test(body), 'KPIs rendered (Total Stock Value)')

  // search should re-query the server
  calls.length = 0
  await page.getByPlaceholder(/Search part/i).fill('IM-6310')
  await page.waitForTimeout(700)
  log(calls.some((c) => c.includes('search=IM-6310')), 'search re-queries the server (search=)', calls.find((c) => c.includes('search')) ?? '')

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
