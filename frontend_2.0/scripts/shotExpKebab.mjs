/* Verify the ⋮ action menu on Expense Tracker rows. BASE=... node scripts/shotExpKebab.mjs */
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
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/expenses')
  await page.waitForTimeout(500)

  const kebabs = await page.getByRole('button', { name: /Actions for/ }).count()
  log(kebabs >= 5, `each expense row has a ⋮ menu (${kebabs})`)
  log((await page.getByRole('button', { name: 'Pay', exact: true }).count()) === 0, 'inline Pay button removed from rows')

  // Open an OVERDUE row's menu → Record payment / Edit / Delete.
  await page.getByRole('button', { name: /Actions for Maintenance/ }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'exp-kebab.png'), fullPage: false })
  for (const label of ['Record payment', 'Edit expense', 'Delete expense']) {
    log((await page.getByRole('menuitem', { name: label }).count()) > 0, `menu item "${label}" present`)
  }
  // A PAID row (Rent) should have no "Record payment" item.
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: /Actions for Rent/ }).click()
  await page.waitForTimeout(300)
  log((await page.getByRole('menuitem', { name: 'Record payment' }).count()) === 0, 'paid row has no "Record payment" item')

  log(errors.length === 0, `no console errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
