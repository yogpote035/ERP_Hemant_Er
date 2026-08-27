/*
 * Deeper e2e — confirms each module's MOCK DATA is wired (a known seeded value
 * shows on its page) and that a real WRITE flow works end-to-end (create an
 * expense → it appears → Undo → it's gone). Run against a built preview:
 *   npm run build && npx vite preview --port 4173 &
 *   BASE=http://localhost:4173 node scripts/e2e-wiring.mjs
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:4173'
let pass = 0, fail = 0
const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++ }

// [navLink, path, a known seeded value that proves the table is populated]
const DATA = [
  ['Inward / Outward', '/inward', '8202421273'],   // golden challan
  ['Stock', '/stock', 'HEW'],
  ['Billing', '/billing', '254/24-25'],
  ['Payments', '/payments', '254/24-25'],           // settled bill on the payments page
  ['Scrap Billing', '/scrap', '1202304726'],        // seeded scrap invoice no
  ['Rejection Advice', '/rejection', 'RJ/24-25/01'],
  ['Expenses', '/expenses', 'Electricity'],
  ['Rate Masters', '/rates', '62.00'],              // p3 current RM rate
  ['Attendance & Payroll', '/attendance', 'Ramesh Patil'],
  ['Masters', '/masters', 'Hemant Engineering Works'],
  ['Users & Roles', '/users', 'Manjiri'],
]

async function gotoPage(page, name, path) {
  await page.getByRole('link', { name, exact: true }).first().click()
  await page.waitForURL((u) => u.pathname === path, { timeout: 8000 })
  await page.locator('main [aria-busy="true"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
  await page.waitForTimeout(250)
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: /Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 6000 })
  }

  // A) Mock data is wired + visible on each module's page.
  for (const [name, path, needle] of DATA) {
    try {
      await gotoPage(page, name, path)
      const found = (await page.locator(`text=${needle}`).count()) > 0
      log(found, `mock data on ${name}: "${needle}"`)
    } catch (e) { log(false, `mock data on ${name} — ${String(e.message).split('\n')[0]}`) }
  }

  // B) Real write flow: create an expense → it appears → Undo → it's gone.
  const TAG = 'ZZ Wiring Probe'
  try {
    await gotoPage(page, 'Expenses', '/expenses')
    await page.getByRole('button', { name: /New expense/i }).first().click()
    await page.getByText('Select unit…').first().click({ timeout: 6000 })
    await page.getByRole('option', { name: /HEW/ }).first().click({ timeout: 5000 })
    await page.keyboard.press('Escape')
    await page.waitForTimeout(200)
    await page.getByLabel('Category').fill(TAG)
    await page.getByLabel(/Total payable/).fill('9999')
    await page.getByRole('button', { name: /Save expense|Create expense/i }).click()
    await page.waitForTimeout(700)
    log((await page.locator('main').getByText(TAG).count()) > 0, 'write flow: created expense appears in table')

    // Undo via the topbar button (focus-independent).
    await page.getByRole('button', { name: /^Undo/ }).first().click()
    await page.waitForTimeout(700)
    log((await page.locator('main').getByText(TAG).count()) === 0, 'write flow: Undo removed the expense')
  } catch (e) {
    log(false, `write flow — ${String(e.message).split('\n')[0]}`)
  }

  log(errors.length === 0, `no uncaught page errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
