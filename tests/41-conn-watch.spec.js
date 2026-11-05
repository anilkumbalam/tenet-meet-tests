// 41 - Stuck reconnect (real meeting, 5 Nov: a laptop's network was suspended; the media library got stuck
// "reconnecting" and the tab showed a frozen meeting). The watch shows "Reconnecting…" after 3 s and "Connection
// lost" with Rejoin when it does not recover (45 s; shortened here). A connected page shows neither.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test.describe.serial('41 - Stuck reconnect', () => {
  test.setTimeout(120000)
  let m, host, guest
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'conn-watch')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Stuck')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('connected: no bar, no Connection lost', async () => {
    await guest.page.waitForTimeout(4000)
    await expect(guest.page.locator('#cw-bar')).toHaveCount(0)
    await expect(guest.page.locator('#rj-screen')).toHaveCount(0)
  })

  test('stuck reconnecting: "Reconnecting…" bar, then Connection lost with Rejoin', async () => {
    const p = guest.page
    await p.evaluate(() => { window.__tenetWatchMs = 8000; window.__tenetRoom.state = 'reconnecting' })
    await expect(p.locator('#cw-bar')).toContainText('Reconnecting', { timeout: 8000 })
    await expect(p.locator('#rj-screen')).toBeVisible({ timeout: 15000 })
    await expect(p.locator('#rj-go')).toBeVisible()
    await expect(p.locator('#cw-bar')).toHaveCount(0)
  })
})
