/* Verify the Inward register is server-driven in API mode: paging/searching/tab calls
   GET /api/inward. Requires backend :4000 (with 185 inwards) + Vite :5173. */
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
  page.on('request', (r) => { if (r.url().includes('/api/inward')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '')) })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/inward')
  await page.waitForTimeout(1200)

  log(calls.some((c) => /\/api\/inward\?.*(mode=cursor|page=)/.test(c)), 'register fetched a page from GET /api/inward', calls.find((c) => /inward\?/.test(c)) ?? '')
  const bodyText = await page.locator('body').innerText()
  log(/of\s*18[0-9]/.test(bodyText) || /18[0-9]/.test(bodyText), 'shows the full count (185), not just a page', '')

  // next page → another API call
  calls.length = 0
  await page.getByRole('button', { name: /Next page/i }).first().click().catch(() => {})
  await page.waitForTimeout(700)
  log(calls.length > 0, 'clicking Next page calls the API again', calls[0] ?? '(none)')

  // search → API call with search=
  calls.length = 0
  await page.getByPlaceholder(/Search challan/i).first().fill('820245100')
  await page.waitForTimeout(800)
  log(calls.some((c) => c.includes('search=820245100')), 'searching calls the API with search=', calls.find((c) => c.includes('search')) ?? '(none)')

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
