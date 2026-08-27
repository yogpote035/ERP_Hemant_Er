/*
 * v2 visual-check — captures the Lovable-mock layout screens.
 *   BASE=http://localhost:5180 node scripts/shoot2.mjs
 * Output: scripts/shots2/<name>.png
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5180'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')

async function setTheme(page, dark) {
  await page.evaluate((d) => document.documentElement.classList.toggle('dark', d), dark)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.25 })
  const page = await context.newPage()
  const shoot = async (name) => {
    await page.waitForTimeout(400)
    await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true })
    console.log('shot', name)
  }

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })

  // Login screen (light + dark) before we authenticate.
  if (page.url().includes('/login')) {
    await shoot('login-light')
    await setTheme(page, true)
    await shoot('login-dark')
    await setTheme(page, false)
    await page.getByRole('button', { name: /Administrator|Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  }

  const go = async (linkName) => {
    await page.getByRole('link', { name: linkName, exact: true }).first().click()
    await page.waitForTimeout(500)
  }

  const screens = [
    ['Dashboard', 'dashboard'],
    ['Raw Material Master', 'materials'],
    ['Vendor Management', 'vendors'],
    ['Material Inward', 'inward'],
    ['Material Outward', 'outward'],
    ['Inventory Stock', 'inventory'],
    ['Billing & Invoice', 'billing'],
    ['Expense Tracker', 'expenses'],
    ['Reports', 'reports'],
    ['Settings', 'settings'],
  ]

  for (const dark of [false, true]) {
    const suffix = dark ? '-dark' : '-light'
    for (const [link, name] of screens) {
      try {
        await go(link)
        await setTheme(page, dark)
        await shoot(name + suffix)
      } catch (e) {
        console.log('skip', name, suffix, String(e).slice(0, 80))
      }
    }
  }

  // Import drawer over the Inward register (light).
  try {
    await setTheme(page, false)
    await go('Material Inward')
    await page.getByRole('button', { name: 'Import', exact: true }).first().click()
    await page.waitForTimeout(500)
    await shoot('inward-import-drawer')
  } catch (e) {
    console.log('skip import-drawer', String(e).slice(0, 80))
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
