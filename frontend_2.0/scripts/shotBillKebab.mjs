/* Verify the ⋮ action menu on Billing rows. BASE=... node scripts/shotBillKebab.mjs */
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
  await navTo(page, '/billing')
  await page.waitForTimeout(500)

  const kebabs = await page.getByRole('button', { name: /Actions for invoice/ }).count()
  log(kebabs >= 4, `each invoice row has a ⋮ menu (${kebabs})`)
  log((await page.getByText('Preview', { exact: true }).count()) === 0, 'inline Preview text removed from rows')

  // Draft 270 → Preview + Finalize.
  await page.getByRole('button', { name: /Actions for invoice 270/ }).click()
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'bill-kebab.png'), fullPage: false })
  log((await page.getByRole('menuitem', { name: 'Preview invoice' }).count()) > 0, 'draft menu has Preview')
  log((await page.getByRole('menuitem', { name: /Finalize/ }).count()) > 0, 'draft menu has Finalize / issue')
  await page.keyboard.press('Escape')

  // Issued 255 → Preview + Download PDF + Void (no Finalize).
  await page.getByRole('button', { name: /Actions for invoice 255/ }).click()
  await page.waitForTimeout(300)
  log((await page.getByRole('menuitem', { name: 'Download PDF' }).count()) > 0, 'issued menu has Download PDF')
  log((await page.getByRole('menuitem', { name: 'Void invoice' }).count()) > 0, 'issued menu has Void')
  log((await page.getByRole('menuitem', { name: /Finalize/ }).count()) === 0, 'issued menu has NO Finalize')

  log(errors.length === 0, `no console errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
