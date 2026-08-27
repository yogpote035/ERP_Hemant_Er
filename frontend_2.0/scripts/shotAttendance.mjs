/* Verify the rebuilt Attendance module. Clears localStorage to load the new seed
 * shape, logs in, and screenshots Production (form+table), Shift, Earnings.
 * BASE=http://localhost:5174 node scripts/shotAttendance.mjs */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')

async function navTo(page, route) {
  await page.evaluate((r) => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, route)
  await page.waitForTimeout(500)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1100 })
  const errors = []
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

  // Fresh seed: clear persisted store, reload, then sign in.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Skip to dashboard/i }).click({ timeout: 8000 })
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  await page.waitForTimeout(400)

  await navTo(page, '/attendance')
  await page.screenshot({ path: join(OUT, 'attn-production.png'), fullPage: true })
  console.log('shot attn-production')

  await page.getByRole('tab', { name: 'Shift' }).click().catch(() => page.getByText('Shift', { exact: true }).first().click())
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'attn-shift.png'), fullPage: true })
  console.log('shot attn-shift')

  await page.getByRole('tab', { name: 'Earnings' }).click().catch(() => page.getByText('Earnings', { exact: true }).first().click())
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'attn-earnings.png'), fullPage: true })
  console.log('shot attn-earnings')

  console.log('console errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 6).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
