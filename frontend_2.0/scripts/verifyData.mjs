/* Data-wiring verifier for frontend_2.0. BASE=http://localhost:5174 node scripts/verifyData.mjs
 * Logs in once (session is in-memory, NOT persisted — so we must NOT reload),
 * then client-side-navigates to every route and reports the real heading, table
 * rows, empty-state flag and console errors per page. Proves the seed data is
 * wired through the UI rather than asserting it. */
import { chromium } from 'playwright'
import { signIn } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5174'

const ROUTES = [
  '/dashboard', '/inventory', '/materials', '/vendors', '/customers', '/inward', '/outward',
  '/billing', '/expenses', '/attendance', '/reports', '/users', '/settings',
  '/masters', '/rates', '/payments', '/scrap', '/rejection',
]

/** Client-side navigation React Router's browser history observes (no reload,
 *  so the in-memory auth session is preserved). */
async function navTo(page, route) {
  await page.evaluate((r) => {
    window.history.pushState({}, '', r)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, route)
  await page.waitForTimeout(450)
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 900 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await signIn(page) // credential login: admin@hew.in / demo
  await page.waitForTimeout(400)

  const report = []
  for (const route of ROUTES) {
    const before = errors.length
    await navTo(page, route)
    const h1 = ((await page.locator('h1').first().textContent().catch(() => '')) ?? '').trim()
    const rows = await page.locator('table tbody tr').count().catch(() => 0)
    const empty = await page.locator('text=/^No .+(yet|to show|found|match|first)/i').first().isVisible().catch(() => false)
    report.push({ route, h1: h1.slice(0, 27), rows, empty, errs: errors.length - before })
  }

  console.log('\n  ROUTE           HEADING                      ROWS  EMPTY  ERR')
  console.log('  ' + '-'.repeat(66))
  for (const r of report) {
    console.log(
      '  ' + r.route.padEnd(15) +
      ' ' + (r.h1 || '—').padEnd(28) +
      ' ' + String(r.rows).padStart(4) +
      '   ' + (r.empty ? 'YES' : ' - ') +
      '   ' + String(r.errs).padStart(2)
    )
  }
  const totalRows = report.reduce((a, r) => a + r.rows, 0)
  const dead = report.filter((r) => r.rows === 0 && r.empty).map((r) => r.route)
  console.log('  ' + '-'.repeat(66))
  console.log(`  total table rows across app : ${totalRows}`)
  console.log(`  pages with NO data          : ${dead.length ? dead.join(', ') : 'none'}`)
  console.log(`  total console errors        : ${errors.length}`)
  if (errors.length) console.log('  first errors:\n    ' + errors.slice(0, 6).join('\n    '))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
