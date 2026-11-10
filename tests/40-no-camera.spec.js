// 40 - No camera (found on a laptop without one, 5 Nov): the test browsers always have a fake camera, so a missing,
// blocked or busy camera was never tried. Here the camera request fails with NotFoundError and no camera is listed.
// 1) no camera anywhere: join page shows the camera button off with a note; the meeting joins with it off; clicking it
//    gives a notice and keeps it off, with no page errors. 2) camera works on the join page but not in the meeting:
//    the meeting shows it off with "joined with audio only".
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

async function guestPage (b, onlyMeeting) {
  const ctx = await b.newContext({ ...H.DESKTOP })
  await ctx.addInitScript(only => {
    if (only && !location.pathname.startsWith('/meeting/')) return
    const md = navigator.mediaDevices; if (!md) return
    const gum = md.getUserMedia.bind(md), en = md.enumerateDevices.bind(md)
    md.getUserMedia = c => (c && c.video) ? Promise.reject(new DOMException('Requested device not found', 'NotFoundError')) : gum(c)
    md.enumerateDevices = async () => (await en()).filter(d => d.kind !== 'videoinput')
  }, onlyMeeting)
  const page = await ctx.newPage(); page.__errs = []
  page.on('pageerror', e => page.__errs.push(e.message))
  return page
}

test.describe.serial('40 - No camera', () => {
  test.setTimeout(150000)
  let m, host, gb
  const B = H.BASE_URL
  const tileOf = name => host.page.locator('#video-grid .video-tile', { hasText: name })
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'no-camera')
    host = await H.joinAsHost(m.meetingId)
    gb = await H.launch('chromium')
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${B}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    if (host) await host.browser.close().catch(() => {})
    if (gb) await gb.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('no camera at all: join page shows it off; meeting joins with it off; clicking it keeps it off with a notice', async () => {
    const p = await guestPage(gb, false)
    await p.goto(`${B}/join/${m.roomUuid}`)
    await expect(p.locator('#wv-cam'), 'join page: camera button off').toHaveAttribute('aria-pressed', 'false', { timeout: 15000 })
    await expect(p.locator('#wv-cam')).toHaveClass(/\boff\b/)
    await expect(p.locator('#wv-note'), 'shared words: no camera found').toContainText('No camera found. You can still join with your microphone.')   // 10 Nov: device-words.js
    await p.fill('#n', 'Guest NoCam')
    await p.locator('#btn').click()
    await expect(p).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await p.waitForFunction(() => window.__tenetRoom && window.__tenetRoom.state === 'connected', null, { timeout: 30000 })
    await expect(p.locator('#btn-cam'), 'meeting: camera button off').toHaveClass(/\boff\b/, { timeout: 15000 })
    await expect(tileOf('Guest NoCam')).toHaveClass(/ts-novideo/, { timeout: 15000 })
    await p.locator('#btn-cam').click()
    await expect(p.locator('#notif-area')).toContainText('camera could not be started', { timeout: 10000 })
    await expect(p.locator('#btn-cam'), 'still off after the click').toHaveClass(/\boff\b/)
    expect(p.__errs, 'no uncaught page errors').toEqual([])
  })

  test('camera works on the join page but not in the meeting: shown off with "joined with audio only"', async () => {
    const p = await guestPage(gb, true)
    await p.goto(`${B}/join/${m.roomUuid}`)
    await expect(p.locator('#wv-cam')).toHaveAttribute('aria-pressed', 'true', { timeout: 15000 })
    await p.fill('#n', 'Guest Unplugged')
    await p.locator('#btn').click()
    await expect(p).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await p.waitForFunction(() => window.__tenetRoom && window.__tenetRoom.state === 'connected', null, { timeout: 30000 })
    await expect(p.locator('#btn-cam')).toHaveClass(/\boff\b/, { timeout: 15000 })
    await expect(p.locator('#notif-area')).toContainText('joined with audio only', { timeout: 10000 })
    await expect(tileOf('Guest Unplugged')).toHaveClass(/ts-novideo/, { timeout: 15000 })
    expect(p.__errs, 'no uncaught page errors').toEqual([])
    await H.expectHealthy(host)
  })
})
