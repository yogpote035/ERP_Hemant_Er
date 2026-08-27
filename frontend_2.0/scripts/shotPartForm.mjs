/* Screenshot the Raw Material form showing the Packing Mode field. BASE=... node scripts/shotPartForm.mjs */
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
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/materials')
  await page.waitForTimeout(500)
  // Edit the first part so the Packing Mode shows pre-filled (GSP-2 after reset).
  await page.getByRole('button', { name: /Edit|Open|⋮|Actions/ }).first().click().catch(() => {})
  await page.waitForTimeout(300)
  // If no edit opened, fall back to New Part.
  if ((await page.getByText('Packing Mode').count()) === 0) {
    await page.getByRole('button', { name: /New Part/ }).first().click().catch(() => {})
    await page.waitForTimeout(400)
  }
  console.log('Packing Mode field visible:', (await page.getByText('Packing Mode').count()) > 0)
  await page.screenshot({ path: join(OUT, 'part-form-packing.png'), fullPage: false })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
