/* Verify multi-select REF DC No (card kept) → one invoice. BASE=... node scripts/shotMultiSelect.mjs */
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
  await page.setViewportSize({ width: 1500, height: 1050 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/outward')
  await page.waitForTimeout(500)

  const combo = page.getByRole('combobox', { name: /REF DC No \(inward challans\)/i })
  await combo.click()
  await page.getByRole('option', { name: /ROLEX-PR-1002/ }).first().click()
  await page.waitForTimeout(250)
  if ((await page.getByRole('option', { name: /ROLEX-IH-1001/ }).count()) === 0) await combo.click()
  await page.getByRole('option', { name: /ROLEX-IH-1001/ }).first().click()
  await page.waitForTimeout(250)
  await page.keyboard.press('Escape')
  await page.waitForTimeout(400)

  log((await combo.innerText()).includes('2'), 'multi-select shows "2 challans selected"')
  const lineRows = await page.locator('table[aria-label="Dispatch lines"] tbody tr').count()
  log(lineRows === 2, `two challans → two dispatch lines (${lineRows})`)
  await page.screenshot({ path: join(OUT, 'multi-select.png'), fullPage: false })

  await page.getByLabel('Line 1 our D/C no').fill('MULTI-1')
  await page.getByLabel('Line 1 OK qty').fill('500')
  await page.getByLabel('Line 1 rate').fill('9')
  await page.getByLabel('Line 2 our D/C no').fill('MULTI-1')
  await page.getByLabel('Line 2 OK qty').fill('600')
  await page.getByLabel('Line 2 rate').fill('8')
  await page.waitForTimeout(200)
  await page.getByRole('button', { name: 'Generate Invoice', exact: true }).click()
  await page.waitForTimeout(1000)
  log(await page.getByText(/Invoice MULTI-1 generated/i).first().isVisible({ timeout: 3000 }).catch(() => false), 'one invoice MULTI-1 generated across the two challans')

  await navTo(page, '/billing')
  await page.waitForTimeout(500)
  const row = page.locator('table tbody tr', { hasText: 'MULTI-1' }).first()
  const rowText = await row.innerText().catch(() => '')
  log(/\b2\b/.test(rowText) && !/draft/i.test(rowText), 'MULTI-1 issued (not draft) with 2 lines')

  log(errors.length === 0, `no console errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
