/*
 * Smoke test — drives the running app with Playwright. Checks every page renders
 * (past the lazy-route Suspense skeleton), then runs the Excel import end-to-end
 * with the sample workbook and verifies the data wired through.
 *   npm run build && npx vite preview --port 4173 &
 *   BASE=http://localhost:4173 node scripts/smoke.mjs
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:4173'
const HERE = dirname(fileURLToPath(import.meta.url))
const SAMPLE = join(HERE, '..', 'public', 'sample', 'HEW-sample-MIO.xlsx')
const OUT = join(HERE, 'shots')

const PAGES = [
  ['Dashboard', '/'], ['Inward / Outward', '/inward'], ['Outward entry', '/dispatch'],
  ['Stock', '/stock'], ['Excel Import', '/import'], ['Billing', '/billing'],
  ['Payments', '/payments'], ['Scrap Billing', '/scrap'], ['Rejection Advice', '/rejection'],
  ['Expenses', '/expenses'], ['Attendance & Payroll', '/attendance'], ['Masters', '/masters'],
  ['Rate Masters', '/rates'], ['Reports', '/reports'], ['Users & Roles', '/users'],
]

let pass = 0, fail = 0
const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++ }

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newContext({ viewport: { width: 1440, height: 900 } }).then((c) => c.newPage())
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: /Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 6000 })
  }

  // 1) Every page renders without crashing.
  for (const [name, path] of PAGES) {
    try {
      await page.getByRole('link', { name, exact: true }).first().click()
      await page.waitForURL((u) => u.pathname === path, { timeout: 8000 })
      // breadcrumb (in the header, outside the lazy <main>) proves the route resolved
      await page.locator('header').getByText(name).first().waitFor({ timeout: 8000 })
      // wait past the Suspense skeleton, then confirm real content + no error fallback
      await page.locator('main [aria-busy="true"]').waitFor({ state: 'detached', timeout: 8000 }).catch(() => {})
      const txt = (await page.locator('main').innerText()).trim()
      const crashed = /something went wrong|unexpected error|cannot read|is not defined/i.test(txt)
      log(!crashed && txt.length > 15, `render: ${name} (${path})`)
    } catch (e) {
      log(false, `render: ${name} (${path}) — ${String(e.message).split('\n')[0]}`)
    }
  }

  // 2) Excel import end-to-end with the sample workbook.
  let imported = false
  try {
    await page.getByRole('link', { name: 'Excel Import', exact: true }).first().click()
    await page.waitForURL((u) => u.pathname === '/import', { timeout: 8000 })
    await page.setInputFiles('input[type=file]', SAMPLE)
    // Step 1 (File & unit): pick the target unit, then "Map columns".
    await page.getByRole('button', { name: /Map columns/ }).waitFor({ timeout: 15000 })
    await page.getByText('Select a unit…').first().click()
    await page.getByRole('option', { name: /HEW/ }).first().click({ timeout: 5000 })
    await page.keyboard.press('Escape').catch(() => {}) // ensure the listbox is closed
    await page.waitForTimeout(200)
    await page.getByRole('button', { name: /Map columns/ }).click({ timeout: 8000 })
    // Step 2 (Map columns): auto-detected → Preview.
    await page.getByRole('button', { name: /Preview/ }).waitFor({ timeout: 8000 })
    await page.getByRole('button', { name: /Preview/ }).click()
    // Step 3 (Preview & import): Import N challans.
    const importBtn = page.getByRole('button', { name: /Import \d/ })
    await importBtn.waitFor({ timeout: 8000 })
    const enabled = await importBtn.isEnabled()
    log(enabled, 'excel import: sample parsed + Import enabled (no errors)')
    if (enabled) { await importBtn.click(); await page.waitForTimeout(1500); imported = true }
  } catch (e) {
    await page.screenshot({ path: join(OUT, 'smoke-import-fail.png'), fullPage: true }).catch(() => {})
    log(false, `excel import flow — ${String(e.message).split('\n')[0]} (see smoke-import-fail.png)`)
  }

  // 3) Data wired through: reconcile stays GREEN + the imported challan shows.
  try {
    await page.getByRole('link', { name: 'Dashboard', exact: true }).first().click()
    await page.waitForTimeout(600)
    log(await page.getByText('Stock reconciled').first().isVisible(), 'reconcile GREEN after import')
  } catch (e) { log(false, `post-import reconcile — ${String(e.message).split('\n')[0]}`) }
  if (imported) {
    try {
      await page.getByRole('link', { name: 'Inward / Outward', exact: true }).first().click()
      await page.waitForTimeout(800)
      log((await page.locator('text=8202421999').count()) > 0, 'imported challan 8202421999 in register')
    } catch (e) { log(false, `imported challan — ${String(e.message).split('\n')[0]}`) }
  }

  log(errors.length === 0, `no uncaught page errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
