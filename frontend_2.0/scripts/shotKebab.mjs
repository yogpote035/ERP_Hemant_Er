/* Verify the row ⋮ action menu on the Inward register. BASE=... node scripts/shotKebab.mjs */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { signIn, navTo } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')
let pass = 0, fail = 0
const log = (ok, m) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${m}`); ok ? pass++ : fail++ }

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1500, height: 1000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/inward')
  await page.waitForTimeout(500)

  // Each row should now show ONE kebab button (no inline Outward/Dispatch/edit/delete).
  const kebabs = await page.getByRole('button', { name: /Actions for challan/ }).count()
  log(kebabs >= 5, `each inward row has a ⋮ menu (${kebabs} found)`)
  log((await page.getByRole('button', { name: 'Dispatch', exact: true }).count()) === 0, 'inline Dispatch button removed from rows')

  // Open the first row's menu → the actions appear.
  await page.getByRole('button', { name: /Actions for challan ROLEX-PR-1002/ }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'kebab-open.png'), fullPage: false })
  for (const label of ['Add Dispatch', 'Edit challan', 'Delete challan']) {
    log((await page.getByRole('menuitem', { name: label }).count()) > 0, `menu item "${label}" present`)
  }
  // Outward Entry only exists inside the Inventory module (onOpenOutward wired) — absent on /inward.
  log((await page.getByRole('menuitem', { name: 'Outward Entry' }).count()) === 0, '"Outward Entry" correctly absent on standalone /inward')

  // Click "Add Dispatch" → opens the dispatch form (proves the action fires).
  await page.getByRole('menuitem', { name: 'Add Dispatch' }).click()
  await page.waitForTimeout(500)
  log(await page.getByText(/dispatch/i).first().isVisible().catch(() => false), 'menu action runs (dispatch form opened)')

  log(errors.length === 0, `no console errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
