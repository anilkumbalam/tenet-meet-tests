// 13 - Meeting layout as people actually see it, on desktop and on a phone:
// phone grid, upright cameras, the screen-share layout for presenter / desktop viewer / phone viewer.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api
let host, tall, phone

test.describe.serial('13 - Layout (desktop and phone)', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'layout-test'))
    host  = await H.joinAsHost(meetingId)
    tall  = await H.joinAsGuest(roomUuid, 'Guest Tall')            // desktop viewer, upright camera
    phone = await H.joinAsGuest(roomUuid, 'Guest Phone', H.PHONE)  // phone viewer
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    await expect(phone.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [tall, phone, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('phone grid: 3 people are shown in 2 columns, page fits the screen', async () => {
    await expect.poll(() => phone.page.evaluate(() => getComputedStyle(document.getElementById('video-grid')).gridTemplateColumns.trim().split(/\s+/).length), { timeout: 10000 }).toBe(2)
    const w = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }))
    expect(w.sw, JSON.stringify(w)).toBeLessThanOrEqual(w.iw + 1)
  })

  test('upright camera: shown whole on desktop, filled (cropped) on a phone', async () => {
    // Guest Tall publishes a tall 360x640 "camera" (as a phone held upright would)
    await tall.page.evaluate(async () => {
      const c = document.createElement('canvas'); c.width = 360; c.height = 640
      const g = c.getContext('2d'); let y = 0
      setInterval(() => { y = (y + 6) % 600; g.fillStyle = '#334155'; g.fillRect(0, 0, 360, 640); g.fillStyle = '#fbbf24'; g.beginPath(); g.arc(180, 120 + y / 3, 60, 0, 7); g.fill() }, 66)
      const track = c.captureStream(15).getVideoTracks()[0]
      await window.__tenetRoom.localParticipant.publishTrack(track, { source: window.LivekitClient.Track.Source.Camera })
    })
    const fitOf = page => page.evaluate(() => {
      const tile = Array.prototype.find.call(document.querySelectorAll('#video-grid .video-tile'), t => t.textContent.includes('Guest Tall'))
      const v = tile && tile.querySelector('video')
      return v && v.videoHeight > 0 ? getComputedStyle(v).objectFit : 'no video yet'
    })
    await expect.poll(() => fitOf(host.page), { timeout: 30000 }).toBe('contain')
    await expect.poll(() => fitOf(phone.page), { timeout: 30000 }).toBe('cover')
  })

  test('presenter (desktop): toolbar button becomes Stop share, pill says You are sharing', async () => {
    await host.page.locator('#btn-screen').click()
    await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(true)
    await expect(host.page.locator('#btn-screen')).toContainText('Stop share', { timeout: 5000 })
    await expect(host.page.locator('#ssl-pill')).toBeVisible()
    await expect(host.page.locator('#ssl-pill')).toContainText("You're sharing")
    await expect(host.page.locator('#screenshare-overlay')).toBeHidden()   // no separate sharing bar
    expect(await H.clickable(host.page, '#btn-mic')).toBe('ok')
    expect(await H.clickable(host.page, '#btn-screen')).toBe('ok')
  })

  test('viewer (desktop): share fits between top bar and toolbar, sharer named once', async () => {
    const p = tall.page
    await expect(p.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
    await p.waitForTimeout(1200)                                         // layout settles (500 ms poll)
    const o = await H.rect(p, '#screenshare-overlay'), tb = await H.rect(p, '#topbar'), ct = await H.rect(p, '#controls')
    const info = JSON.stringify({ o, tb, ct })
    expect(o.top, info).toBeGreaterThanOrEqual(tb.bottom - 1)
    expect(o.bottom, info).toBeLessThanOrEqual(ct.top + 1)
    expect(o.w * o.h, info).toBeGreaterThan(0.5 * 1280 * (ct.top - tb.bottom) * 0.6)
    expect(await H.clickable(p, '#btn-mic')).toBe('ok')
    expect(await H.clickable(p, '#btn-screen')).toBe('ok')
    // "<name> is sharing" appears exactly once on screen (the pill), not again in the share bar
    const shown = await p.evaluate(() => Array.prototype.filter.call(document.querySelectorAll('body *'), e => {
      const own = Array.prototype.some.call(e.childNodes, n => n.nodeType === 3 && /is sharing/i.test(n.textContent))
      const r = e.getBoundingClientRect()
      return own && e.closest('#notif-area') === null && r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden'
    }).length)
    expect(shown).toBe(1)
    await expect(p.locator('#ssl-pill')).toContainText('is sharing')
    await expect(p.locator('#ss-thumbs')).toBeHidden()                   // camera strip hidden by default
  })

  test('viewer (phone): share fills the screen, page no wider than the phone', async () => {
    const p = phone.page
    await expect(p.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
    await p.waitForTimeout(1200)
    const s = await p.evaluate(() => {
      const r = document.getElementById('screenshare-overlay').getBoundingClientRect()
      return { sw: document.documentElement.scrollWidth, iw: innerWidth, ih: innerHeight, vv: Math.round(visualViewport.width),
               l: Math.round(r.left), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }
    })
    const info = JSON.stringify(s)
    expect(s.sw, info).toBeLessThanOrEqual(s.iw + 1)        // nothing pushes the page wider (browser would zoom out)
    expect(s.vv, info).toBe(390)
    expect(Math.abs(s.w - s.iw), info).toBeLessThanOrEqual(2)
    expect(Math.abs(s.h - s.ih), info).toBeLessThanOrEqual(2)
    expect(Math.abs(s.l) + Math.abs(s.t), info).toBeLessThanOrEqual(2)
    await expect(p.locator('#ssl-pill')).toBeHidden()
  })

  test('stop share: toolbar back to Share, share closes for everyone', async () => {
    await host.page.locator('#btn-screen').click()
    await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(false)
    await expect(host.page.locator('#btn-screen')).not.toContainText('Stop share', { timeout: 5000 })
    await expect(host.page.locator('#ssl-pill')).toBeHidden({ timeout: 5000 })
    await expect(tall.page.locator('#screenshare-overlay')).not.toHaveClass(/active/, { timeout: 15000 })
    await expect(phone.page.locator('#screenshare-overlay')).not.toHaveClass(/active/, { timeout: 15000 })
    await expect(tall.page.locator('#ssl-pill')).toBeHidden({ timeout: 5000 })
  })
})
