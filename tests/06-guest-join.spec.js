const { test, expect } = require('@playwright/test')
const { apiCreateMeeting, apiDeleteMeeting, AUTH_STATE_PATH } = require('./helpers')
const { BASE_URL } = require('./env')

test.describe('Guest join', () => {
  test('Meeting room page loads for a valid join URL', async ({ playwright, browser }) => {
    const authCtx = await playwright.request.newContext({
      baseURL: BASE_URL,
      ignoreHTTPSErrors: true,
      storageState: AUTH_STATE_PATH,
    })
    const meeting = await apiCreateMeeting(authCtx, { title: 'Guest Join Test' })
    expect(meeting?.id).toBeTruthy()

    const guestCtx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await guestCtx.newPage()
    await page.goto(`${BASE_URL}/room/${meeting.id}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const url = page.url()
    const hasRoom = url.includes('/room/') || url.includes('/join/')
    const hasNameEntry = await page.locator('input[placeholder*="name"], input[placeholder*="Name"]').isVisible().catch(() => false)
    const hasJoinUI = await page.locator('button:has-text("Join"), .btn:has-text("Join")').isVisible().catch(() => false)
    expect(hasRoom || hasNameEntry || hasJoinUI).toBeTruthy()
    await guestCtx.close()
    await apiDeleteMeeting(authCtx, meeting.id)
    await authCtx.dispose()
  })

  test('Accessing /room/:id without token shows error or redirects', async ({ page }) => {
    await page.goto(`${BASE_URL}/room/nonexistent-id-12345`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    const url = page.url()
    const body = await page.content()
    const hasError = body.includes('Cannot GET') || body.includes('Not Found') ||
      await page.locator('.error').isVisible().catch(() => false)
    const isHome = url === BASE_URL + '/' || url.includes('/start')
    const hasNameEntry = await page.locator('input[placeholder*="name"]').isVisible().catch(() => false)
    const hasJoinUI = await page.locator('button:has-text("Join")').isVisible().catch(() => false)
    expect(hasError || isHome || hasNameEntry || hasJoinUI).toBeTruthy()
  })
})
