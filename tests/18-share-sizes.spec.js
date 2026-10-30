// 18 - Screen sharing from different screens: small laptop, 1080p, 1440p, 4K, ultrawide, upright monitor.
// The sender sends at most 2560x1440 (shape kept), one stream, max 1.5 Mbps / 5 fps; a desktop viewer receives
// exactly that and sees the whole picture (not cropped or stretched); a phone viewer gets it full screen and
// the page does not widen. The test machine has no real 4K screen: the fake screen shrinks like Chrome does.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const SCREENS = [
  ['small laptop 1280x720',     [1280, 720],  [1280, 720]],
  ['full HD 1920x1080',         [1920, 1080], [1920, 1080]],
  ['QHD 2560x1440',             [2560, 1440], [2560, 1440]],
  ['4K 3840x2160',              [3840, 2160], [2560, 1440]],
  ['ultrawide 3440x1440',       [3440, 1440], [2560, 1072]],
  ['upright monitor 1080x1920', [1080, 1920], [810, 1440]],
]

let meetingId, roomUuid, api, host, viewer, phone

const sending = page => page.evaluate(() => {
  const L = window.LivekitClient, pub = window.__tenetRoom.localParticipant.getTrackPublication(L.Track.Source.ScreenShare)
  const snd = pub && pub.track && pub.track.sender; if (!snd) return 'no sender yet'
  const e = snd.getParameters().encodings || []
  return e.length + ' stream, ' + (e[0] && e[0].maxBitrate) + ' bps, ' + (e[0] && e[0].maxFramerate) + ' fps'
})
const received = page => page.evaluate(() => {
  const v = document.querySelector('#screenshare-main video')
  return v && v.videoWidth ? v.videoWidth + 'x' + v.videoHeight : 'nothing yet'
})

test.describe.serial('18 - Screen share at different screen sizes', () => {

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'share-sizes'))
    host   = await H.joinAsHost(meetingId)
    viewer = await H.joinAsGuest(roomUuid, 'Guest Viewer')
    phone  = await H.joinAsGuest(roomUuid, 'Guest Phone', H.PHONE)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
  })

  test.afterEach(async () => {
    if (host && await H.isSharing(host.page).catch(() => false)) {
      await host.page.locator('#btn-screen').click().catch(() => {})
      await expect.poll(() => H.isSharing(host.page), { timeout: 15000 }).toBe(false)
    }
    await expect(viewer.page.locator('#screenshare-overlay')).not.toHaveClass(/active/, { timeout: 15000 })
    await H.expectHealthy(host, viewer, phone)
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [viewer, phone, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  for (const [label, screen, expected] of SCREENS) {
    test(`${label}: sent as ${expected.join('x')}, received whole by desktop and phone`, async () => {
      await host.page.evaluate(sz => { window.__screenSize = sz }, screen)
      await host.page.locator('#btn-screen').click()
      await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(true)

      const shot = await host.page.evaluate(() => window.__lastScreen)
      expect(shot.asked, 'size the app asks the browser for').toEqual({ width: 2560, height: 1440 })
      expect(shot.captured, 'size captured').toEqual(expected)
      await expect.poll(() => sending(host.page), { timeout: 10000 }).toBe('1 stream, 1500000 bps, 5 fps')

      const want = expected.join('x')
      await expect(viewer.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
      await expect.poll(() => received(viewer.page), { timeout: 40000, intervals: [1000] }).toBe(want)
      const fit = await viewer.page.evaluate(() => {
        const v = document.querySelector('#screenshare-main video'), r = v.getBoundingClientRect(), o = document.getElementById('screenshare-overlay').getBoundingClientRect()
        return { objectFit: getComputedStyle(v).objectFit, inside: r.left >= o.left - 1 && r.right <= o.right + 1 && r.top >= o.top - 1 && r.bottom <= o.bottom + 1, w: Math.round(r.width), h: Math.round(r.height) }
      })
      expect(fit.objectFit, 'picture shown whole, not cropped or stretched').toBe('contain')
      expect(fit.inside, 'picture inside the share area ' + JSON.stringify(fit)).toBe(true)
      expect(await H.clickable(viewer.page, '#btn-mic')).toBe('ok')

      await expect(phone.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
      await expect.poll(() => received(phone.page), { timeout: 40000, intervals: [1000] }).toBe(want)
      const ph = await phone.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
      expect(ph.sw, 'phone page width ' + JSON.stringify(ph)).toBeLessThanOrEqual(ph.iw + 1)
    })
  }
})
