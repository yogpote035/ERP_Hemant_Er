/* Verify Inward + Outward forms match the client formats. BASE=... node scripts/shotForms.mjs */
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

  // Outward form
  await navTo(page, '/outward')
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'form-outward.png'), fullPage: false })
  for (const col of ['Our D/C No', 'Our D.C Date', 'M/C rej', 'MF', 'Remark']) {
    console.log(`outward col "${col}":`, (await page.getByRole('columnheader', { name: col, exact: true }).count()) > 0 ? 'yes' : 'NO')
  }
  console.log('REF DC Date field:', (await page.getByText('REF DC Date (auto)').count()) > 0 ? 'yes' : 'NO')

  // Inward form (open the modal)
  await navTo(page, '/inward')
  await page.waitForTimeout(400)
  await page.getByRole('button', { name: /Inward entry/ }).first().click()
  await page.waitForTimeout(500)
  await page.screenshot({ path: join(OUT, 'form-inward.png'), fullPage: false })
  for (const f of ['RM Rate / pc (₹)', 'RM Wt / pc (g)', 'Finish Wt / pc (g)']) {
    console.log(`inward field "${f}":`, (await page.getByText(f, { exact: true }).count()) > 0 ? 'yes' : 'NO')
  }
  console.log('errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
