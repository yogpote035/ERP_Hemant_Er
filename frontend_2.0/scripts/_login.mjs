/* Shared helper: sign in with the new Login ID + Password credential form. */
export async function signIn(page, email = 'admin@hew.in', password = 'demo') {
  if (page.url().includes('/login') || (await page.getByText(/Enter your Login ID/i).count()) > 0) {
    await page.getByPlaceholder('you@hew.in').fill(email)
    await page.getByPlaceholder('••••••').fill(password)
    await page.getByRole('button', { name: /^Sign in/ }).click()
    await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 8000 })
  }
}

export async function navTo(page, route) {
  await page.evaluate((r) => { window.history.pushState({}, '', r); window.dispatchEvent(new PopStateEvent('popstate')) }, route)
  await page.waitForTimeout(450)
}
