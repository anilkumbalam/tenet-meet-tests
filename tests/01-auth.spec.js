const { test, expect } = require('@playwright/test')
const { loginWithZoho, AUTH_STATE_PATH } = require('./helpers')

test.describe('Authentication', () => {
  test('JWT auth succeeds and dashboard loads', async ({ page, context }) => {
    await loginWithZoho(page)
    await page.waitForSelector('.tab-btn', { timeout: 20000 })
    expect(page.url()).not.toContain('/start')
    await context.storageState({ path: AUTH_STATE_PATH })
    console.log('✅ Auth state saved to', AUTH_STATE_PATH)
  })

  test('Unauthenticated visit to / redirects to /start', async ({ page }) => {
    await page.goto('/', { waitUntil: 'domcontentloaded' })
    await page.waitForURL(/\/(start)/, { timeout: 15000 }).catch(() => {})
    const url = page.url()
    expect(url.includes('/start') || url.includes('accounts.zoho.com')).toBeTruthy()
  })
})
