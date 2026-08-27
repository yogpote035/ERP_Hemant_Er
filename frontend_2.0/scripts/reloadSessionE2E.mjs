/* Verify API-mode session survives a reload (token re-validated via /auth/me) and
   a dead token bounces to /login. Requires backend :4000 + Vite :5173 (API mode).
   Usage: node scripts/reloadSessionE2E.mjs */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const APP = process.env.BASE ?? 'http://localhost:5173'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page) // admin

  await navTo(page, '/inventory')
  await page.waitForTimeout(400)

  // Reload — the in-memory session is gone, but the token should restore it.
  const calls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.method() + ' ' + r.url().replace(/^https?:\/\/[^/]+/, '').split('?')[0]) })
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)

  log(calls.some((c) => c === 'GET /api/auth/me'), 'reload re-validated the token via /auth/me')
  log(!page.url().includes('/login'), 'reload did NOT bounce to /login (session restored)', page.url())
  const bodyText = await page.locator('body').innerText()
  log(/Inventory|Stock View|Raw Material/.test(bodyText), 'restored straight onto the deep-linked page')

  // Dead token → cleared + bounced to /login.
  await page.evaluate(() => localStorage.setItem('hew_api_token', 'bad.invalid.token'))
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(800)
  log(page.url().includes('/login'), 'dead token bounced to /login', page.url())
  const cleared = await page.evaluate(() => localStorage.getItem('hew_api_token'))
  log(!cleared, 'dead token was cleared from storage')

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
