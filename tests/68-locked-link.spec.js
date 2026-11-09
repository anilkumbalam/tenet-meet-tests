// 68 - A locked meeting on the guest link (9 Nov). The guest is told at once that the meeting is locked: no camera or
// microphone asked for, no name box. The page checks by itself; when the host unlocks, the normal join page opens.
// The server's open meeting check (/api/room) says locked only for a locked meeting that is not over.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test.describe.serial('68 - Locked meeting on the guest link', () => {
  test.setTimeout(120000)
  let m, ctx, page
  const room = () => m.api.request.get(`${H.BASE_URL}/api/room/${m.roomUuid}`).then(r => r.json())
  const lock = on => m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/lock`, { data: { locked: on } })
  test.beforeAll(async ({ browser }) => { m = await H.createMeeting(browser, 'lock-link') })
  test.afterAll(async () => {
    if (ctx) await ctx.close().catch(() => {})
    if (m) { await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {}); await m.api.close().catch(() => {}) }
  })

  test('server: /api/room says locked only while locked', async () => {
    expect((await room()).locked, 'open meeting').toBe(false)
    expect((await lock(true)).ok(), 'host locks').toBe(true)
    const r = await room()
    expect(r.locked, 'locked').toBe(true)
    expect(r.final, 'not a final screen').toBeNull()
  })

  test('guest: told at once, no camera or microphone asked for, no name box', async ({ browser }) => {
    ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await ctx.addInitScript(() => {
      window.__mediaAsked = 0
      if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) { const o = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices); navigator.mediaDevices.getUserMedia = c => { window.__mediaAsked++; return o(c) } }
    })
    page = await ctx.newPage()
    await page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
    await expect(page.locator('h1')).toHaveText('This meeting is locked', { timeout: 10000 })
    await expect(page.locator('.jv-card')).toContainText('The host isn’t letting new people join right now.')
    await expect(page.locator('#jl-retry')).toBeVisible()
    await expect(page.locator('#jl-note')).toContainText('checks by itself')
    await expect(page.locator('#n'), 'no name box').toHaveCount(0)
    await expect(page.locator('#wv-video'), 'no camera preview').toHaveCount(0)
    await page.waitForTimeout(2000)
    expect(await page.evaluate(() => window.__mediaAsked), 'camera / mic never asked for').toBe(0)
    await page.locator('#jl-retry').click()
    await expect(page.locator('#jl-note'), 'Try again while still locked says so').toContainText('Still locked')
    await expect(page.locator('#jl-retry')).toBeEnabled()
  })

  test('host unlocks: the normal join page opens by itself', async () => {
    expect((await lock(false)).ok(), 'host unlocks').toBe(true)
    await expect(page.locator('#n'), 'the name box appears without a click').toBeVisible({ timeout: 20000 })
    await expect(page.locator('h1')).toHaveText('Ready to join?')
    expect((await room()).locked).toBe(false)
  })

  test('an ended meeting shows its final screen, never "locked"', async () => {
    expect((await lock(true)).ok()).toBe(true)
    expect((await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/end`)).ok()).toBe(true)
    const r = await room()
    expect(r.final).toBe('ended')
    expect(r.locked, 'over, not locked').toBe(false)
  })
})
