/*
 * Visual-check harness — drives the running dev server with Playwright and
 * captures light + dark screenshots of the key screens so the UI can be diffed
 * against the mock. Not part of the app bundle; run manually:
 *
 *   node scripts/shoot.mjs            # against http://localhost:5173
 *   BASE=http://localhost:5174 node scripts/shoot.mjs
 *
 * Output: scripts/shots/<name>.png
 */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const BASE = process.env.BASE ?? 'http://localhost:5173'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots')

async function setTheme(page, dark) {
  await page.evaluate((d) => {
    document.documentElement.classList.toggle('dark', d)
  }, dark)
}

async function main() {
  await mkdir(OUT, { recursive: true })
  const browser = await chromium.launch()
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1.5 })
  const page = await context.newPage()

  // Boot + mock login as admin. The session is in-memory only (not persisted),
  // so AFTER login we navigate via SPA links — a full page reload would log out.
  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  if (page.url().includes('/login')) {
    await page.getByRole('button', { name: /Admin/ }).first().click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 5000 })
  }

  const go = async (linkName, headingRe) => {
    await page.getByRole('link', { name: linkName, exact: true }).first().click()
    await page.getByRole('heading', { name: headingRe }).first().waitFor({ timeout: 5000 })
  }
  const shoot = async (name) => {
    await page.waitForTimeout(350)
    await page.screenshot({ path: join(OUT, name + '.png'), fullPage: true })
    console.log('shot', name)
  }

  for (const dark of [false, true]) {
    const suffix = dark ? '-dark' : '-light'

    // Dashboard
    await go('Dashboard', /Dashboard/)
    await setTheme(page, dark)
    await shoot('dashboard' + suffix)

    // Inward / Outward register — expand the golden challan to show dispatches.
    await go('Inward / Outward', /Inward \/ Outward register/)
    await setTheme(page, dark)
    try {
      await page.getByRole('button', { name: /8202421273/ }).first().click({ timeout: 2000 })
    } catch {
      try {
        await page.locator('tbody button[aria-expanded]').first().click({ timeout: 2000 })
      } catch {
        /* no expandable rows */
      }
    }
    await shoot('register' + suffix)

    // Outward entry — fill a billed line + a rejection line to show live totals.
    await go('Outward entry', /Add outward entry/)
    await setTheme(page, dark)
    try {
      await page.getByLabel('Line 1 bill or DC no').fill('255/24-25', { timeout: 2000 })
      await page.getByLabel('Line 1 OK qty').fill('1200')
      await page.getByRole('button', { name: 'Add dispatch line' }).click()
      await page.getByLabel('Line 2 machine reject').fill('242')
    } catch {
      /* page may show the empty state if no open challans */
    }
    await shoot('outward' + suffix)

    // P3-P6 pages (light pass is enough for layout).
    if (!dark) {
      for (const [link, re, name] of [
        ['Excel Import', /Excel import/, 'import'],
        ['Billing', /Billing/, 'billing'],
        ['Payments', /Payments/, 'payments'],
        ['Scrap Billing', /Scrap bills/, 'scrap'],
        ['Expenses', /Expenses/, 'expenses'],
        ['Rejection Advice', /Rejection advice/, 'rejection'],
        ['Attendance & Payroll', /Attendance/, 'attendance'],
      ]) {
        try {
          await go(link, re)
          await shoot(name)
        } catch {
          /* skip if route/link not found */
        }
      }
    }
  }

  await browser.close()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
