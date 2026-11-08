// 35 - v4 tiles (redesign stage 2): alone message with Copy invite link; name pill with mic icon (on / off);
// initial circle when the camera is off; a guest whose mic is missing gets "Your microphone isn't connected" and the
// host sees "No mic" on their tile; Try again fixes it.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test.describe.serial('35 - v4 tile states', () => {
  test.setTimeout(150000)
  let m, host, guest
  const tileOf = (page, name) => page.locator('#video-grid .video-tile', { hasText: name })
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'tile-states')
    host = await H.joinAsHost(m.meetingId)
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('host alone: "only one here" with Copy invite link; gone when someone joins', async () => {
    const alone = host.page.locator('#ts-alone')
    await expect(alone).toBeVisible({ timeout: 15000 })
    await expect(alone).toContainText('only one here')
    await expect(host.page.locator('#ts-invite')).toBeVisible()
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Tiles')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    await expect(alone).toBeHidden({ timeout: 10000 })
  })

  test('name pill shows the mic; camera off shows the initial circle; muting shows the crossed mic', async () => {
    const t = tileOf(host.page, 'Guest Tiles')
    await expect(t.locator('.ts-mic svg')).toBeVisible({ timeout: 15000 })
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).toMatch(/^(on|speaking)$/)
    await expect(t.locator('.audio-indicator'), 'old dot hidden').toBeHidden()
    await guest.page.locator('#btn-cam').click()
    await expect(t).toHaveClass(/ts-novideo/, { timeout: 15000 })
    await expect(t.locator('.tile-avatar')).toBeVisible()
    await expect(t.locator('.tile-avatar')).toHaveText(/^G/)
    await guest.page.locator('#btn-mic').click()
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).toBe('off')
  })

  test('mic missing: the guest sees the banner, the host sees "No mic"; Try again fixes it', async () => {
    await guest.page.evaluate(async () => {
      const r = window.__tenetRoom, pub = r.localParticipant.getTrackPublication(window.LivekitClient.Track.Source.Microphone)
      if (pub && pub.track) await r.localParticipant.unpublishTrack(pub.track)
    })
    await expect(guest.page.locator('#ts-mic-banner')).toBeVisible({ timeout: 15000 })
    await expect(guest.page.locator('#ts-mic-banner')).toContainText('microphone isn’t connected')
    const t = tileOf(host.page, 'Guest Tiles')
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).toBe('nomic')
    await expect(t.locator('.ts-extra')).toHaveText('No mic')
    await guest.page.locator('#ts-mic-retry').click()
    await expect(guest.page.locator('#ts-mic-banner')).toBeHidden({ timeout: 15000 })
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).not.toBe('nomic')
    await H.expectHealthy(host, guest)
  })
})
