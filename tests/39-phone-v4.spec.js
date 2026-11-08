// 39 - v4 phones (redesign stage 5): More menu opens as a sheet from the bottom; full-page People & Chat has Close;
// Host settings opens as a bottom sheet with Done; the top bar shows the logo and the meeting title only.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test.describe.serial('39 - v4 phones', () => {
  test.setTimeout(150000)
  let m, host, guest
  const sheet = async (page, sel) => {
    const r = await page.locator(sel).evaluate(e => { const b = e.getBoundingClientRect(); return { bottom: b.bottom, width: b.width } }), vp = page.viewportSize()
    expect(Math.abs(r.bottom - vp.height), sel + ' sits on the bottom edge').toBeLessThan(3)
    expect(r.width, sel + ' is full width').toBeGreaterThan(vp.width - 3)
  }
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'phone-v4')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Phone', H.PHONE)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('phone: logo-only top bar; More opens as a bottom sheet', async () => {
    const p = guest.page
    await expect(p.locator('body')).toHaveClass(/\btb-phone\b/)
    expect(await p.evaluate(() => getComputedStyle(document.querySelector('#topbar .brand')).fontSize), 'wordmark hidden').toBe('0px')
    await p.locator('#btn-more').click()
    await expect(p.locator('#tb-more-menu')).toBeVisible()
    await sheet(p, '#tb-more-menu')
    await p.keyboard.press('Escape')
    await expect(p.locator('#tb-more-menu')).toBeHidden()
  })

  test('phone: People & Chat is a full page with Close', async () => {
    const p = guest.page
    await H.openPanel(p)
    await expect(p.locator('#ph-close')).toBeVisible({ timeout: 10000 })
    await expect(p.locator('#video-grid-container')).toBeHidden()
    await p.locator('#ph-close').click()
    await expect(p.locator('#video-grid-container')).toBeVisible()
    await expect(p.locator('#right-panel')).toHaveClass(/\bhidden\b/)
  })

  test('host on a phone-sized screen: Host settings is a bottom sheet with Done', async () => {
    const p = host.page
    await p.setViewportSize({ width: 390, height: 844 })
    await expect(p.locator('body')).toHaveClass(/\btb-phone\b/, { timeout: 10000 })
    await H.openPanel(p)
    await p.locator('#hs-btn').click()
    await expect(p.locator('#hs-pop')).toBeVisible()
    await sheet(p, '#hs-pop')
    await p.locator('#ph-done').click()
    await expect(p.locator('#hs-pop')).toBeHidden()
    await p.setViewportSize({ width: 1440, height: 900 })
    await expect(p.locator('#ph-close')).toBeHidden()
    await H.expectHealthy(host, guest)
  })
})
