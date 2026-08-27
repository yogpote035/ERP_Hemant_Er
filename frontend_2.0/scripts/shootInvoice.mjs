/* Capture the Billing page + the invoice Preview modal.  BASE=http://localhost:5174 node scripts/shootInvoice.mjs */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: /Administrator|Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  }
  await page.getByRole('link', { name: 'Billing & Invoice', exact: true }).first().click()
  await page.waitForTimeout(600)
  await page.screenshot({ path: join(OUT, 'billing-light.png'), fullPage: true })
  console.log('shot billing-light')

  await page.getByRole('button', { name: /Preview invoice/ }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'invoice-preview.png'), fullPage: true })
  console.log('shot invoice-preview')

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
