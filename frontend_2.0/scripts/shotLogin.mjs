/* Screenshot the new credential login + prove sign-in works. BASE=... node scripts/shotLogin.mjs */
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
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.waitForTimeout(400)
  await page.screenshot({ path: join(OUT, 'login-form.png') })
  console.log('shot login-form')

  // Wrong password → error
  await page.getByPlaceholder('you@hew.in').fill('admin@hew.in')
  await page.getByPlaceholder('••••••').fill('wrong')
  await page.getByRole('button', { name: /^Sign in/ }).click()
  await page.waitForTimeout(400)
  console.log('bad-password error visible:', await page.getByText(/incorrect password/i).isVisible().catch(() => false))

  // Correct demo creds → in
  await page.getByPlaceholder('••••••').fill('demo')
  await page.getByRole('button', { name: /^Sign in/ }).click()
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 }).catch(() => {})
  console.log('signed in →', new URL(page.url()).pathname)
  console.log('console/page errors:', errors.length)
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
