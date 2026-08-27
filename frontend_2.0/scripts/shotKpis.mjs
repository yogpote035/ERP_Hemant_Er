/* Capture the pages that gained KPI strips. BASE=http://localhost:5174 node scripts/shotKpis.mjs */
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
  await page.setViewportSize({ width: 1440, height: 900 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: /Administrator|Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  }
  for (const [link, name] of [['Inventory Stock', 'kpi-inventory'], ['Billing & Invoice', 'kpi-billing'], ['Expense Tracker', 'kpi-expenses']]) {
    await page.getByRole('link', { name: link, exact: true }).first().click()
    await page.waitForTimeout(600)
    await page.screenshot({ path: join(OUT, name + '.png'), clip: { x: 240, y: 52, width: 1200, height: 320 } })
    console.log('shot', name)
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
