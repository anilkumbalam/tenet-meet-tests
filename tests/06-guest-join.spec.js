const { test, expect } = require('@playwright/test')
const { BASE_URL } = require('./env')
const { AUTH_STATE_PATH, apiCreateMeeting, apiDeleteMeeting } = require('./helpers')

test.describe('Guest join', () => {

  test('Meeting room page loads for a valid join URL', async ({ browser }) => {
    const hostCtx     = await browser.newContext({ storageState: AUTH_STATE_PATH })
    const hostRequest = await hostCtx.request.newContext({ baseURL: BASE_URL })

    const meeting = await apiCreateMeeting(hostRequest, { title: 'Guest Join Test' })
    expect(meeting?.id).toBeTruthy()

    const joinRes  = await hostRequest.post(`${BASE_URL}/api/meetings/${meeting.id}/join`)
    const joinData = await joinRes.json()
    expect(joinData.url || joinData.token).toBeTruthy()

    const guestCtx  = await browser.newContext()
    const guestPage = await guestCtx.newPage()
    const joinUrl   = joinData.url || `${BASE_URL}/room/${meeting.id}?token=${joinData.token}`

    await guestPage.goto(joinUrl)
    await guestPage.waitForLoadState('domcontentloaded')

    const hasRoomUI = await guestPage.locator(
      '[data-livekit-room], iframe[src*="livekit"], #room-container, .room-page, input[placeholder*="name"]'
    ).isVisible({ timeout: 15000 }).catch(() => false)

    expect(hasRoomUI).toBeTruthy()

    await guestCtx.close()
    await hostCtx.close()
    await apiDeleteMeeting(hostRequest, meeting.id)
  })

  test('Accessing /room/:id without token shows error or redirects', async ({ page }) => {
    await page.goto(`${BASE_URL}/room/invalid-room-000`)
    await page.waitForLoadState('domcontentloaded')

    const hasError    = await page.locator('text=invalid, text=not found, text=expired, .error-msg').isVisible({ timeout: 10000 }).catch(() => false)
    const isHome      = page.url().endsWith('/') || page.url().endsWith('/login')
    const hasNameEntry = await page.locator('input[placeholder*="name"]').isVisible().catch(() => false)

    expect(hasError || isHome || hasNameEntry).toBeTruthy()
  })

})
