/* Drive a real import of the client MIO workbook + verify dashboard.
 * BASE=http://localhost:5174 node scripts/importReal.mjs */
import { chromium } from 'playwright'
import { mkdir } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { signIn, navTo } from './_login.mjs'

const BASE = process.env.BASE ?? 'http://localhost:5174'
const OUT = join(dirname(fileURLToPath(import.meta.url)), 'shots2')
const FILE = process.env.FILE ?? 'C:/Users/Admin/Downloads/ROLEX RING LIMITED MIO 2025-26.xlsx'

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
  await navTo(page, '/inward')
  await page.waitForTimeout(400)

  // Open the import drawer + upload the file.
  await page.getByRole('button', { name: /^Import/ }).first().click()
  await page.waitForTimeout(400)
  await page.setInputFiles('input[type=file]', FILE)
  await page.waitForTimeout(1200)

  // Pick the target unit (HEW) via the dropdown's search box. Sheet defaults to first; header auto-detected.
  await page.getByRole('combobox').filter({ hasText: /Select a unit/ }).click()
  await page.getByPlaceholder('Search…').fill('HEW')
  await page.waitForTimeout(200)
  await page.keyboard.press('Enter')
  await page.waitForTimeout(300)
  await page.screenshot({ path: join(OUT, 'import-1-file.png'), fullPage: true })
  console.log('header-row note:', await page.getByText(/Header detected on/).innerText().catch(() => '?'))

  await page.getByRole('button', { name: /Map columns/ }).click()
  await page.waitForTimeout(500)
  await page.getByRole('button', { name: /^Preview/ }).click()
  await page.waitForTimeout(900)
  await page.screenshot({ path: join(OUT, 'import-2-preview.png'), fullPage: true })

  // Read the import button label (shows challan count) + whether it's enabled.
  const importBtn = page.getByRole('button', { name: /Import \d/ })
  const importLabel = await importBtn.innerText().catch(() => '(no import button)')
  const enabled = await importBtn.isEnabled().catch(() => false)
  console.log('preview import button:', importLabel, '· enabled:', enabled)
  console.log('issues header:', await page.getByText(/error.* · .*warning/).innerText().catch(() => 'none'))

  if (enabled) {
    await importBtn.click()
    await page.waitForTimeout(2000)
    console.log('result:', await page.getByText(/Import complete/).isVisible().catch(() => false) ? 'COMPLETE' : 'not complete')
    console.log('summary:', await page.locator('text=/challans · .* dispatches/').innerText().catch(() => '?'))
    await page.screenshot({ path: join(OUT, 'import-3-done.png'), fullPage: true })
    // Close drawer + check dashboard.
    await page.getByRole('button', { name: /Done — view register|View register/ }).first().click().catch(() => {})
    await page.waitForTimeout(500)
    await navTo(page, '/dashboard')
    await page.waitForTimeout(800)
    await page.screenshot({ path: join(OUT, 'import-4-dashboard.png'), fullPage: true })
  }

  console.log('console/page errors:', errors.length)
  if (errors.length) console.log(errors.slice(0, 6).join('\n'))
  await browser.close()
}
main().catch((e) => { console.error(e); process.exit(1) })
