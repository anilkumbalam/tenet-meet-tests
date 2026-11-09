const { test, expect } = require('./guard')
const { apiCreateMeeting, apiDeleteMeeting, AUTH_STATE_PATH } = require('./helpers')
const { BASE_URL } = require('./env')

// 06 - Guest join (rewritten 9 Nov: exact expectations; the old checks passed for any page whose address had /room/ in it)
test.describe('Guest join', () => {
  test('a valid guest link shows the join page: name box and Join button', async ({ playwright, browser }) => {
    const authCtx = await playwright.request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true, storageState: AUTH_STATE_PATH })
    const meeting = await apiCreateMeeting(authCtx, { title: 'Guest Join Test' })
    expect(meeting && meeting.room_uuid, 'the meeting has a guest link code').toBeTruthy()
    const guestCtx = await browser.newContext({ ignoreHTTPSErrors: true })
    try {
      const page = await guestCtx.newPage()
      const res = await page.goto(`${BASE_URL}/join/${meeting.room_uuid}`, { waitUntil: 'domcontentloaded' })
      expect(res.status(), 'join page answers').toBe(200)
      await expect(page.locator('#n'), 'name box').toBeVisible({ timeout: 15000 })
      await expect(page.locator('#btn'), 'Join button').toBeVisible()
    } finally {
      await guestCtx.close()
      await apiDeleteMeeting(authCtx, meeting.id)
      await authCtx.dispose()
    }
  })

  test('a guest link that does not exist says "Meeting not found" and offers no join form', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/join/00000000-0000-4000-8000-000000000000`, { waitUntil: 'domcontentloaded' })
    expect(res.status(), 'no server error').toBeLessThan(500)
    await expect(page.locator('body')).toContainText('Meeting not found', { timeout: 15000 })
    await expect(page.locator('#n:visible'), 'no name box').toHaveCount(0)
  })

  test('the old /room/ address is gone: no server error, no join form', async ({ page }) => {
    const res = await page.goto(`${BASE_URL}/room/nonexistent-id-12345`, { waitUntil: 'domcontentloaded' })
    expect(res.status(), 'no server error').toBeLessThan(500)
    await expect(page.locator('#n:visible'), 'no name box').toHaveCount(0)
  })
})
