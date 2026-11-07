// 53 - A guest leaves (7 Nov: final-v4.js v3, join-v4.js v9).
//  - "You left the meeting" with Rejoin and the line "To leave, just close this tab."
//  - Back from there shows the same screen on the join page — no camera preview, no camera request.
//  - Rejoin on it gives the normal join page; opening the link afresh also gives the normal join page.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let m = {}, host, gctx

test.describe.serial('53 - Guest leaves', () => {
  test.setTimeout(150000)

  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'guest-left')
    host = await H.joinAsHost(m.meetingId)
  })
  test.afterAll(async () => {
    if (m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    if (gctx) await gctx.close().catch(() => {})
    if (host) await host.browser.close().catch(() => {})
    if (m.api) await m.api.close().catch(() => {})
  })

  test('guest joins from the link, leaves: Rejoin and "To leave, just close this tab."; Back shows the same, no camera', async ({ browser }) => {
    gctx = await browser.newContext({ permissions: ['camera', 'microphone'] })
    await gctx.addInitScript(() => {
      window.__camAsks = 0
      const md = navigator.mediaDevices
      if (md && md.getUserMedia) { const g = md.getUserMedia.bind(md); md.getUserMedia = c => { window.__camAsks++; return g(c) } }
    })
    const page = await gctx.newPage()
    await page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
    await page.locator('#n').fill('Guest Back')
    await page.locator('#btn').click()
    await expect(page).toHaveURL(/\/meeting\//, { timeout: 20000 })
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })

    await page.locator('#btn-end').click()
    await expect(page.locator('#ended-screen h2')).toHaveText('You left the meeting', { timeout: 5000 })
    await expect(page.locator('#fv-rejoin')).toBeVisible()
    await expect(page.locator('#ended-screen')).toContainText('To leave, just close this tab.')

    await page.goBack()
    await expect(page).toHaveURL(/\/join\//)
    await expect(page.locator('#card h1')).toHaveText('You left the meeting', { timeout: 5000 })
    await expect(page.locator('#jl-rejoin')).toBeVisible()
    await expect(page.locator('#card')).toContainText('To leave, just close this tab.')
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => window.__camAsks), 'camera asked for on the Back screen').toBe(0)
    await expect(page.locator('#n')).toHaveCount(0)                                              // no name form

    await page.locator('#jl-rejoin').click()                                                     // Rejoin: the normal join page
    await expect(page.locator('#n')).toBeVisible({ timeout: 10000 })
  })

  test('opening the link afresh after leaving shows the normal join page', async () => {
    const page = await gctx.newPage()
    await page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
    await expect(page.locator('#n')).toBeVisible({ timeout: 10000 })
    await expect(page.locator('#jl-rejoin')).toHaveCount(0)
  })
})
