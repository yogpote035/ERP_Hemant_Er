/* Verify the 5-feature reviewer batch. BASE=http://localhost:5174 node scripts/shotReviewerBatch.mjs */
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
  await page.setViewportSize({ width: 1440, height: 1100 })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)

  const checks = []
  const has = async (re) => (await page.getByText(re).count()) > 0

  // 1 + 5: Inventory → Stock View KPIs + date filter (Stock View is the 4th tab)
  await navTo(page, '/inventory')
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /Stock View/i }).first().click().catch(() => {})
  await page.waitForTimeout(600)
  checks.push(['Stock: Active Part Numbers KPI', await has(/Active Part Numbers/i)])
  checks.push(['Stock: Total Stock Value KPI', await has(/Total Stock Value/i)])
  checks.push(['Stock: Movement from filter', (await page.getByLabel(/Stock movement from date/i).count()) > 0])
  await page.screenshot({ path: join(OUT, 'rb-stock.png'), fullPage: false })

  // 2: Inward/Outward KPIs + date filter
  await navTo(page, '/inward')
  await page.waitForTimeout(600)
  checks.push(['Inward: Total Outward Qty KPI', await has(/Total Outward Qty/i)])
  checks.push(['Inward: Total Outward Value KPI', await has(/Total Outward Value/i)])
  checks.push(['Inward: Challans from date filter', (await page.getByLabel(/Challans from date/i).count()) > 0])
  await page.screenshot({ path: join(OUT, 'rb-inward.png'), fullPage: false })

  // 3: Raw Material Master search
  await navTo(page, '/materials')
  await page.waitForTimeout(600)
  const searchBox = page.getByPlaceholder(/Search by part no/i)
  checks.push(['Materials: part search box', (await searchBox.count()) > 0])
  if ((await searchBox.count()) > 0) {
    await searchBox.first().fill('zzznomatch999')
    await page.waitForTimeout(300)
    checks.push(['Materials: no-results state', await has(/No matches/i)])
    await searchBox.first().fill('')
    await page.waitForTimeout(200)
  }
  await page.screenshot({ path: join(OUT, 'rb-materials.png'), fullPage: false })

  // 4: Billing — invoice date filter + payment menu item
  await navTo(page, '/billing')
  await page.waitForTimeout(600)
  checks.push(['Billing: date from filter', (await page.getByLabel(/from/i).count()) > 0 || (await page.locator('input[type=date]').count()) > 0])
  await page.screenshot({ path: join(OUT, 'rb-billing.png'), fullPage: false })

  console.log('\n=== Reviewer batch verification ===')
  let ok = true
  for (const [name, pass] of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`)
    if (!pass) ok = false
  }
  await browser.close()
  process.exit(ok ? 0 : 1)
}
main().catch((e) => { console.error(e); process.exit(1) })
