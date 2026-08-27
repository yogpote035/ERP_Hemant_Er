/* Verify every list page fetches its pages from the API (server-driven pagination).
   Requires backend :4000 + Vite :5173 (API mode). */
import { chromium } from 'playwright'
import { signIn, navTo } from './_login.mjs'

const APP = process.env.BASE ?? 'http://localhost:5173'
let pass = 0, fail = 0
const log = (ok, name, extra = '') => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); ok ? pass++ : fail++ }

// route → the API path its table should fetch
const PAGES = [
  ['/materials', '/api/masters/parts'],
  ['/inward', '/api/inward'],
  ['/billing', '/api/invoices'],
  ['/payments', '/api/payments'],
  ['/expenses', '/api/expenses'],
  ['/scrap', '/api/scrap'],
  ['/rejection', '/api/rejection'],
  ['/attendance', '/api/attendance/production'],
  ['/users', '/api/users'],
]

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const calls = []
  page.on('request', (r) => { if (r.url().includes('/api/')) calls.push(r.url().replace(/^https?:\/\/[^/]+/, '')) })

  await page.goto(APP + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)

  for (const [route, api] of PAGES) {
    calls.length = 0
    await navTo(page, route)
    await page.waitForTimeout(900)
    const hit = calls.find((c) => c.startsWith(api + '?') && c.includes('mode=cursor'))
    log(!!hit, `${route.padEnd(12)} → ${api}?mode=cursor`, hit ?? `(calls: ${calls.filter((c) => c.startsWith(api)).join(',') || 'none'})`)
  }

  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
