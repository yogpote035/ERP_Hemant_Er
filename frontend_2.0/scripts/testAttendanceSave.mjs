/* Drive the rebuilt Attendance module end-to-end: save a production entry through
 * the new form (unit derived from employee, new fields + validation), then exercise
 * the Earnings date filter. BASE=http://localhost:5174 node scripts/testAttendanceSave.mjs */
import { chromium } from 'playwright'

const BASE = process.env.BASE ?? 'http://localhost:5174'
let pass = 0, fail = 0
const log = (ok, msg) => { console.log(`${ok ? 'PASS' : 'FAIL'}  ${msg}`); ok ? pass++ : fail++ }

async function pick(page, comboName, optionRe) {
  await page.getByRole('combobox', { name: comboName, exact: true }).click()
  await page.getByRole('option', { name: optionRe }).first().click()
}

async function main() {
  const browser = await chromium.launch()
  const page = await browser.newPage()
  await page.setViewportSize({ width: 1440, height: 1000 })
  const errors = []
  page.on('pageerror', (e) => errors.push(String(e)))

  await page.goto(BASE + '/', { waitUntil: 'networkidle' })
  await page.evaluate(() => localStorage.clear())
  await page.reload({ waitUntil: 'networkidle' })
  await page.getByRole('button', { name: /Skip to dashboard/i }).click({ timeout: 8000 })
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  await page.evaluate(() => { window.history.pushState({}, '', '/attendance'); window.dispatchEvent(new PopStateEvent('popstate')) })
  await page.waitForTimeout(600)

  // ── Production save ──────────────────────────────────────────────────────────
  const rowsBefore = await page.locator('table tbody tr').count()
  await pick(page, 'Employee', /Ramesh Patil/)
  await pick(page, 'Machine', /MC-01/)
  await pick(page, 'Part', /IM-6308-ALS/)
  await pick(page, 'Operation', /^1F/)            // 1st Finish → resolves the ₹2.50 rate
  await page.getByLabel('Standard', { exact: true }).fill('1200')
  await page.getByLabel('Plan', { exact: true }).fill('1250')
  await page.getByLabel('Total make qty', { exact: true }).fill('100')
  await page.getByLabel('OK qty', { exact: true }).fill('95')
  await page.getByLabel('Scrap', { exact: true }).fill('3')
  await page.getByLabel('Rework', { exact: true }).fill('2')
  await page.waitForTimeout(200)

  const saveBtn = page.getByRole('button', { name: /Save production/ })
  log(await saveBtn.isEnabled(), 'Save enabled once employee→unit derived + rate resolved + breakdown reconciles')
  await saveBtn.click()
  log(await page.getByText(/Production saved/i).first().isVisible({ timeout: 4000 }).catch(() => false), 'success toast "Production saved" fired')
  await page.waitForTimeout(800)
  const rowsAfter = await page.locator('table tbody tr').count()
  log(rowsAfter === rowsBefore + 1, `register grew by one row (${rowsBefore} → ${rowsAfter})`)
  log((await page.locator('text=95').count()) > 0, 'new OK qty 95 visible in the register')

  // ── Negative: breakdown > total is blocked ───────────────────────────────────
  await page.getByLabel('Total make qty', { exact: true }).fill('10')
  await page.getByLabel('OK qty', { exact: true }).fill('95')
  await page.waitForTimeout(200)
  log(!(await page.getByRole('button', { name: /Save production/ }).isEnabled()), 'Save disabled when OK+Scrap+Rework+MF exceeds total made')

  // ── Earnings date filter ─────────────────────────────────────────────────────
  await page.getByText('Earnings', { exact: true }).first().click()
  await page.waitForTimeout(400)
  const allRows = await page.locator('table tbody tr').count()
  log(allRows >= 2, `earnings shows employees with no filter (${allRows})`)
  // Far-future window → no entries fall inside.
  await page.getByLabel('From', { exact: true }).fill('2030-01-01')
  await page.waitForTimeout(400)
  log(await page.getByText(/No earnings in this period/i).isVisible().catch(() => false), 'far-future range → empty-period state')
  await page.getByRole('button', { name: /^Clear$/ }).click()
  await page.waitForTimeout(400)
  log((await page.locator('table tbody tr').count()) >= 2, 'Clear restores all earnings rows')

  log(errors.length === 0, `no uncaught page errors (${errors.length})`)
  if (errors.length) console.log(errors.slice(0, 5).join('\n'))
  console.log(`\n${pass} passed, ${fail} failed`)
  await browser.close()
  process.exit(fail ? 1 : 0)
}
main().catch((e) => { console.error(e); process.exit(1) })
