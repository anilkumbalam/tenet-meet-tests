// 22 - A scheduled meeting that runs past its planned end time is NOT cut off while people are in it.
// (Meetings still end automatically once nobody has been in them for 15 minutes.)
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test('scheduled 1-minute meeting keeps going past its end time while people are in it', async ({ browser }) => {
  test.setTimeout(300000)
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  await H.setAuthCookie(ctx)
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000 - 60 * 1000).toISOString().slice(0, 19).replace('T', ' ')   // started a minute ago (IST)
  const r = await ctx.request.post(`${H.BASE_URL}/api/meetings`, { data: { title: 'overtime-' + Date.now().toString(36), scheduled_at: ist, timezone: 'Asia/Kolkata', duration_minutes: 1 } })
  expect(r.ok()).toBe(true)
  const m = await r.json()
  const host = await H.joinAsHost(m.id)
  const guest = await H.joinAsGuest(m.room_uuid, 'Guest Overtime')
  try {
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    // planned end has passed; wait for two runs of the server's once-a-minute clean-up job
    await host.page.waitForTimeout(150000)
    expect((await H.meetingStatus(ctx, m.id)).status, 'meeting still on').toBe('active')
    expect(await H.roomState(guest.page)).toBe('connected')
    await expect(guest.page.locator('#ended-screen.show')).toHaveCount(0)
    await H.expectHealthy(host, guest)
  } finally {
    await ctx.request.post(`${H.BASE_URL}/api/meetings/${m.id}/cancel`).catch(() => {})
    await guest.browser.close().catch(() => {}); await host.browser.close().catch(() => {}); await ctx.close()
  }
})
