/* Screenshot the enhanced dashboard. BASE=... node scripts/shotDash.mjs */
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
  await page.setViewportSize({ width: 1440, height: 1700 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/dashboard')
  await page.waitForTimeout(800)
  await page.screenshot({ path: join(OUT, 'dashboard-v2.png'), fullPage: true })
  for (const t of ['Stock Movement', 'Pending Payments']) {
    console.log(`"${t}" chart:`, (await page.getByText(t, { exact: true }).count()) > 0 ? 'yes' : 'NO')
  }
  console.log('errors:', errors.length)
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
