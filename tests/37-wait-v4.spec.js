// 37 - v4 waiting room = Ready to join (redesign stage 4): camera preview with mic / camera / device choice while
// waiting; on admission the meeting opens straight away with those settings (no second Ready to join); sent back shows
// "Returned to the waiting room"; Leave; people on v3 keep the old waiting page.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test.describe.serial('37 - v4 waiting room', () => {
  test.setTimeout(180000)
  let m, host, g
  const B = H.BASE_URL
  const list = async () => (await m.api.request.get(`${B}/api/meetings/${m.meetingId}/waiting`)).json()
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'wait-v4')
    expect((await m.api.request.patch(`${B}/api/meetings/${m.meetingId}`, { data: { waiting_room: 1 } })).status()).toBeLessThan(300)
    host = await H.joinAsHost(m.meetingId)
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${B}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, g]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('waiting page shows the preview; mic and camera can be switched off; the old page stays for v3', async () => {
    g = await H.openAsGuest(m.roomUuid, 'Guest Wv', H.DESKTOP, 'test-dev-wv-0001')
    expect(g.body.lobby, JSON.stringify(g.body)).toBe(true)
    await expect(g.page).toHaveURL(/\/wait\/[0-9a-f]{32}$/)
    await expect(g.page.locator('#head')).toHaveText('Waiting for the host to let you in')
    await expect(g.page.locator('#title')).not.toBeEmpty({ timeout: 10000 })
    await expect(g.page.locator('#wv-name')).toHaveText('Guest Wv')
    await expect(g.page.locator('#wv-net')).toHaveClass(/great|good|slow/, { timeout: 15000 })
    await g.page.locator('#wv-dev').click()
    await expect(g.page.locator('#wv-sel-mic')).toBeVisible()
    await g.page.locator('#wv-mic').click()
    await expect(g.page.locator('#wv-mic')).toHaveAttribute('aria-pressed', 'false')
    await g.page.locator('#wv-cam').click()
    await expect(g.page.locator('#wv-cam')).toHaveAttribute('aria-pressed', 'false')
    await expect(g.page.locator('#stage')).not.toHaveClass(/\bcam\b/)
    await expect(g.page.locator('#wv-initial')).toHaveText('G')
    const v3 = await m.api.request.get(g.page.url() + '?ui=3')
    expect(await v3.text(), 'v3 people keep the old waiting page').toContain('/js/wait.js')
    expect((await m.api.request.get(g.page.url() + '?ui=4')).headers()['x-meet-ui']).toBe('4')
  })

  test('let in: the meeting opens at once with mic and camera off, no second Ready to join', async () => {
    await expect.poll(async () => (await list()).waiting.length, { timeout: 10000 }).toBe(1)
    const wid = (await list()).waiting[0].id
    expect((await m.api.request.post(`${B}/api/meetings/${m.meetingId}/waiting/admit`, { data: { ids: [wid] } })).status()).toBe(200)
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await g.page.waitForFunction(() => window.__tenetRoom && window.__tenetRoom.state === 'connected', null, { timeout: 30000 })
    await expect(g.page.locator('#av-check-screen')).not.toHaveClass(/\bshow\b/)
    expect(await g.page.evaluate(() => sessionStorage.getItem('tenet_prejoin')), 'hand-over used once').toBeNull()
    const t = host.page.locator('#video-grid .video-tile', { hasText: 'Guest Wv' })
    await expect(t).toBeVisible({ timeout: 30000 })
    await expect(t).toHaveClass(/ts-novideo/, { timeout: 15000 })
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).toBe('off')
    await expect(g.page.locator('#btn-mic')).toHaveClass(/\boff\b/)
    await expect(g.page.locator('#btn-cam')).toHaveClass(/\boff\b/)
  })

  test('sent back: "Returned to the waiting room"; Leave takes them off the list', async () => {
    const who = ((await list()).admitted.find(a => a.name === 'Guest Wv') || {}).identity
    expect(who, 'Guest Wv listed as let in').toBeTruthy()
    expect((await m.api.request.post(`${B}/api/meetings/${m.meetingId}/send-back/${encodeURIComponent(who)}`)).status()).toBe(200)
    await expect(g.page).toHaveURL(/\/wait\//, { timeout: 15000 })
    await expect(g.page.locator('#head')).toHaveText('Returned to the waiting room', { timeout: 10000 })
    await expect(g.page.locator('#status')).toContainText('You may be admitted again shortly')
    await g.page.locator('#leave').click()
    await expect(g.page.locator('#head')).toHaveText('You left the waiting room')
    await expect.poll(async () => (await list()).waiting.length, { timeout: 10000 }).toBe(0)
    await H.expectHealthy(host)
  })
})
