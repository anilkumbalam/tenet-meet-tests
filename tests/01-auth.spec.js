const { test, expect } = require('@playwright/test')
const { loginWithZoho, ensureAuthDir, AUTH_STATE_PATH, waitForDashboard } = require('./helpers')

test.describe('Authentication', () => {

  test('Zoho OAuth login succeeds and dashboard loads', async ({ page }) => {
    ensureAuthDir()
    await loginWithZoho(page)
    await waitForDashboard(page)
    expect(page.url()).toContain(process.env.BASE_URL || '')
    const tabCount = await page.locator('.tab-btn').count()
    expect(tabCount).toBeGreaterThanOrEqual(1)
    await page.context().storageState({ path: AUTH_STATE_PATH })
    console.log(`✅ Auth state saved to ${AUTH_STATE_PATH}`)
  })

  test('Unauthenticated visit to / shows sign-in', async ({ page }) => {
    await page.goto('/')
    await page.waitForLoadState('domcontentloaded')
    const url = page.url()
    const hasLoginUI = await page.locator(
      'a[href*="/auth/zoho"], button:has-text("Sign in"), [href*="accounts.zoho.com"]'
    ).isVisible().catch(() => false)
    const isOnZoho = url.includes('accounts.zoho.com')
    expect(hasLoginUI || isOnZoho).toBeTruthy()
  })

})
