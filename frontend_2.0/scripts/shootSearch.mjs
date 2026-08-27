/* Capture the global search dropdown. BASE=http://localhost:5174 node scripts/shootSearch.mjs */
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
  const box = page.getByRole('combobox', { name: /Search invoices/ })
  for (const term of ['IM', 'sun', 'rolex']) {
    await box.fill(term)
    await page.waitForTimeout(450)
    await page.screenshot({ path: join(OUT, `search-${term}.png`), clip: { x: 560, y: 0, width: 470, height: 430 } })
    console.log('shot', term)
  }
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
