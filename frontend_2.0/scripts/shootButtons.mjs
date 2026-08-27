/* Capture button-rich screens to verify the CTA upgrade. BASE=http://localhost:5174 node scripts/shootButtons.mjs */
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
  const go = async (name) => { await page.getByRole('link', { name, exact: true }).first().click(); await page.waitForTimeout(600) }

  await go('Vendor Management')
  await page.screenshot({ path: join(OUT, 'btn-vendors.png'), fullPage: true })
  console.log('shot btn-vendors')

  // Hover the primary CTA to show elevation.
  try {
    await page.getByRole('button', { name: /New Vendor/ }).first().hover()
    await page.waitForTimeout(250)
    await page.screenshot({ path: join(OUT, 'btn-vendors-hover.png'), clip: { x: 980, y: 110, width: 460, height: 220 } })
    console.log('shot btn-vendors-hover')
  } catch (e) { console.log('skip hover', String(e).slice(0, 60)) }

  await go('Billing & Invoice')
  await page.getByRole('button', { name: /Preview invoice/ }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'btn-invoice-modal.png'), fullPage: true })
  console.log('shot btn-invoice-modal')

  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
