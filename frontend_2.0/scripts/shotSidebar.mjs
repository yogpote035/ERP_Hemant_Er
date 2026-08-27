/* Confirm Attendance & Payroll now shows on the sidebar rail and routes correctly.
 * BASE=http://localhost:5174 node scripts/shotSidebar.mjs */
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
  await page.getByRole('button', { name: /Skip to dashboard/i }).click({ timeout: 8000 })
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  await page.waitForTimeout(400)

  const link = page.getByRole('link', { name: 'Attendance & Payroll', exact: true })
  const onRail = await link.first().isVisible().catch(() => false)
  console.log('Attendance & Payroll on sidebar:', onRail)
  if (onRail) {
    await link.first().click()
    await page.waitForTimeout(600)
    console.log('navigated to:', new URL(page.url()).pathname)
  }
  await page.screenshot({ path: join(OUT, 'sidebar-attendance.png'), fullPage: false })
  console.log('shot sidebar-attendance')
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
