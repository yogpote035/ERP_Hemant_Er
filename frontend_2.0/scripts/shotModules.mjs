/* Verify Customer + User Management modules on the rail. BASE=... node scripts/shotModules.mjs */
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
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await signIn(page)

  for (const item of ['Inventory', 'Vendor Management', 'Customer Management', 'User Management']) {
    const on = await page.getByRole('link', { name: item, exact: true }).first().isVisible().catch(() => false)
    console.log(`sidebar "${item}":`, on ? 'yes' : 'NO')
  }

  await navTo(page, '/customers')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'customers.png'), fullPage: false })
  console.log('shot customers; rows:', await page.locator('table tbody tr').count())

  await navTo(page, '/users')
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'users.png'), fullPage: false })
  console.log('shot users; login-id label present:', (await page.getByText(/Login ID \/ Email/i).count()) > 0)

  console.log('errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
