/* Verify the Packing Details section in the invoice (finalize) form. BASE=... node scripts/shotBilling.mjs */
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
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/billing')
  await page.waitForTimeout(500)
  // Switch to the Draft filter so the draft invoice's Finalize action is visible.
  await page.getByRole('tab', { name: /draft/i }).click().catch(() => page.getByText(/^Draft/i).first().click().catch(() => {}))
  await page.waitForTimeout(400)
  const btn = page.getByRole('button', { name: 'Finalize', exact: true }).first()
  console.log('Finalize buttons:', await page.getByRole('button', { name: 'Finalize', exact: true }).count())
  if (await btn.count()) { await btn.click().catch(() => {}); await page.waitForTimeout(800) }
  await page.screenshot({ path: join(OUT, 'billing-packing.png'), fullPage: false })
  console.log('Packing Details section:', (await page.getByText('Packing Details', { exact: true }).count()) > 0 ? 'yes' : 'NO')
  console.log('errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
