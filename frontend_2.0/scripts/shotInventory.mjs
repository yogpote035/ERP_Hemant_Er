/* Verify the consolidated Inventory module (tabs) + new Stock categories.
 * BASE=http://localhost:5174 node scripts/shotInventory.mjs */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { signIn, navTo } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')

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

  // Sidebar should now show one "Inventory" item.
  const invOnRail = await page.getByRole('link', { name: 'Inventory', exact: true }).first().isVisible().catch(() => false)
  console.log('Inventory on sidebar:', invOnRail)
  const gone = await page.getByRole('link', { name: 'Material Inward', exact: true }).count()
  console.log('old "Material Inward" sidebar item present?:', gone > 0)

  await navTo(page, '/inventory')
  // Default tab = Raw Material Master
  await page.screenshot({ path: join(OUT, 'inventory-materials.png'), fullPage: false })
  console.log('shot inventory-materials')

  // Stock View tab → new categories
  await page.getByRole('tab', { name: 'Stock View' }).click().catch(() => page.getByText('Stock View', { exact: true }).first().click())
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'inventory-stock.png'), fullPage: false })
  console.log('shot inventory-stock')
  for (const col of ['Opening', 'Inward', 'Outward', 'Disposed / Scrap', 'Available']) {
    const has = await page.getByRole('columnheader', { name: col, exact: true }).count()
    console.log(`  stock column "${col}":`, has > 0 ? 'yes' : 'NO')
  }

  // Outward tab
  await page.getByRole('tab', { name: 'Outward Entry' }).click().catch(() => page.getByText('Outward Entry', { exact: true }).first().click())
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'inventory-outward.png'), fullPage: false })
  console.log('shot inventory-outward')

  console.log('errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
