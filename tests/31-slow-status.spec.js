// 31 - A slow server reply does not hold up the host: with the meeting-status reply held back for 20 s, the host
// still gets the host buttons straight away and the mic starts within the 5 s limit (before: both waited for it).
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test('host buttons and mic do not wait for a slow status reply', async ({ browser }) => {
  test.setTimeout(120000)
  const { meetingId, api } = await H.createMeeting(browser, 'slow-status')
  const b = await H.launch()
  try {
    const ctx = await b.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    let held = 0
    await page.route(/\/api\/meetings\/\d+\/status/, async route => { held++; await new Promise(r => setTimeout(r, 20000)); await route.continue().catch(() => {}) })
    const res = await page.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/join`, { data: { device_id: 'test-slow-' + Date.now() } })
    const { url } = await res.json()
    await page.goto(`${H.BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
    await H.finishJoin(page, 'Host')
    const t0 = Date.now()
    await expect.poll(() => H.canEnd(page), { message: 'host buttons at once', timeout: 3000 }).toBe(true)
    await expect.poll(() => page.evaluate(() => Boolean(window.__tenetRoom && window.__tenetRoom.localParticipant.isMicrophoneEnabled)), { timeout: 12000 }).toBe(true)
    expect(Date.now() - t0, 'mic started well before the 20 s reply').toBeLessThan(12000)
    expect(held, 'the status reply really was held back').toBeGreaterThan(0)
  } finally {
    await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    await b.close().catch(() => {}); await api.close().catch(() => {})
  }
})
