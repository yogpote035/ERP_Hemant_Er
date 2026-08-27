import { chromium } from 'playwright'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mkdir } from 'node:fs/promises'
import { signIn, navTo } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5173'
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
  await page.waitForTimeout(700)
  // shrink page size to force 2 pages over 13 parts
  await page.getByLabel('Rows per page').selectOption('10').catch(() => {})
  await page.waitForTimeout(300)
  console.log('pager present:', (await page.getByText(/of 13|Page 1 of/).count()) > 0)
  console.log('search present:', (await page.getByPlaceholder(/Search/i).count()) > 0)
  await page.screenshot({ path: join(OUT, 'paging-materials.png'), fullPage: false })
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
