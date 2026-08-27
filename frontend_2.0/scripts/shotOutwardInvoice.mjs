/* Verify Outward Entry → one-click Generate Invoice. BASE=... node scripts/shotOutwardInvoice.mjs */
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
  await page.setViewportSize({ width: 1440, height: 1100 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)

  // Count issued invoices before.
  await navTo(page, '/billing')
  await page.waitForTimeout(400)
  await page.getByRole('tab', { name: /issued/i }).click().catch(() => {})
  await page.waitForTimeout(300)
  const issuedBefore = await page.locator('table tbody tr').count()

  await navTo(page, '/outward')
  await page.waitForTimeout(500)
  // Pick ROLEX-PR-1002 (has 5,000 available + customer Rolex).
  await page.getByRole('combobox', { name: /REF DC No/i }).click()
  await page.getByRole('option', { name: /ROLEX-PR-1002/ }).first().click()
  await page.waitForTimeout(300)
  await page.getByLabel('Line 1 our D/C no').fill('DC-AUTOGEN-1')
  await page.getByLabel('Line 1 OK qty').fill('1000')
  await page.getByLabel('Line 1 rate').fill('9')
  await page.waitForTimeout(200)
  await page.screenshot({ path: join(OUT, 'outward-invoice.png'), fullPage: false })

  const btn = page.getByRole('button', { name: 'Generate Invoice', exact: true })
  log(await btn.isVisible(), 'button renamed to "Generate Invoice"')
  await btn.click()
  await page.waitForTimeout(900)
  log(await page.getByText(/Invoice .* generated/i).first().isVisible({ timeout: 3000 }).catch(() => false), 'toast confirms an invoice was generated')

  // Verify an ISSUED invoice now exists for the new bill.
  await navTo(page, '/billing')
  await page.waitForTimeout(500)
  await page.getByRole('tab', { name: /issued/i }).click().catch(() => {})
  await page.waitForTimeout(400)
  const issuedAfter = await page.locator('table tbody tr').count()
  log(issuedAfter === issuedBefore + 1, `issued invoices grew by one (${issuedBefore} → ${issuedAfter})`)
  log((await page.getByText('DC-AUTOGEN-1').count()) > 0, 'the new bill DC-AUTOGEN-1 is issued (not draft)')

  log(errors.length === 0, `no console errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
