/* Verify the invoice Packing Details match the client format. BASE=... node scripts/shotPacking.mjs */
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
  await page.setViewportSize({ width: 1440, height: 1200 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)
  await navTo(page, '/billing')
  await page.waitForTimeout(500)

  // Preview bill 255 (golden challan, 26,020 pcs → GSP-2 1050 boxes + remainder).
  await page.getByRole('button', { name: /Actions for invoice 255/ }).click()
  await page.waitForTimeout(300)
  await page.getByRole('menuitem', { name: 'Preview invoice' }).click()
  await page.waitForTimeout(700)
  const sheet = (await page.locator('#invoice-print').innerText().catch(() => '')) || ''
  const packingIdx = sheet.indexOf('Packing Details')
  console.log('--- packing block ---')
  console.log(sheet.slice(packingIdx, packingIdx + 200).replace(/\n+/g, ' | '))
  console.log('has GSP-2:', /GSP-2/.test(sheet))
  console.log('has TOTAL:', /TOTAL/.test(sheet))
  console.log('has Packing Mode in line block:', /Packing Mode/.test(sheet))
  // Screenshot just the printable invoice sheet.
  await page.locator('#invoice-print').screenshot({ path: join(OUT, 'packing-invoice.png') }).catch(async () => {
    await page.screenshot({ path: join(OUT, 'packing-invoice.png'), fullPage: false })
  })
  console.log('errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
