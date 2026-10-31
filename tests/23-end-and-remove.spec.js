// 23 - Ending and removing are final (the meeting page, the server and LiveKit agree).
// Ending a meeting closes the LiveKit room: everyone sees "Meeting Ended" at once.
// A removed guest is out: reloading does not bring them back, and the join link refuses that device.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const endedTitle = page => page.evaluate(() => { const e = document.getElementById('ended-screen'); return e && e.classList.contains('show') ? e.querySelector('h2').textContent : 'still in' })

test.describe.serial('23 - Ending and removing are final', () => {
  test.setTimeout(180000)

  test('host ends the meeting: the guest sees "Meeting Ended" within seconds', async ({ browser }) => {
    const { meetingId, roomUuid, api } = await H.createMeeting(browser, 'end-final')
    const host = await H.joinAsHost(meetingId), guest = await H.joinAsGuest(roomUuid, 'Guest End')
    try {
      await expect(guest.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      const st = await host.page.evaluate(id => fetch('/api/meetings/' + id + '/end', { method: 'POST' }).then(r => r.status), meetingId)
      expect(st).toBeLessThan(300)
      await expect.poll(() => endedTitle(guest.page), { timeout: 10000 }).toBe('Meeting Ended')   // not after the 15 s status check
    } finally { for (const p of [guest, host]) await p.browser.close().catch(() => {}); await api.close().catch(() => {}) }
  })

  test('cancelling from the dashboard also closes the room', async ({ browser }) => {
    const { meetingId, roomUuid, api } = await H.createMeeting(browser, 'cancel-final')
    const host = await H.joinAsHost(meetingId), guest = await H.joinAsGuest(roomUuid, 'Guest Cancel')
    try {
      await expect(guest.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      expect((await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`)).status()).toBeLessThan(300)
      await expect.poll(() => endedTitle(guest.page), { timeout: 10000 }).toBe('Meeting Ended')
    } finally { for (const p of [guest, host]) await p.browser.close().catch(() => {}); await api.close().catch(() => {}) }
  })

  test('removed guest: reloading does not bring them back, and the join link refuses them', async ({ browser }) => {
    const { meetingId, roomUuid, api } = await H.createMeeting(browser, 'remove-final')
    const host = await H.joinAsHost(meetingId), guest = await H.joinAsGuest(roomUuid, 'Guest Removed')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await guest.page.waitForTimeout(2000)                                    // first heartbeat has reported the device
      const gid = await guest.page.evaluate(() => window.__tenetRoom.localParticipant.identity)
      const meetingUrl = guest.page.url()                                       // the address they would reload
      const st = await host.page.evaluate(([id, who]) => fetch('/api/meetings/' + id + '/kick/' + encodeURIComponent(who), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status), [meetingId, gid])
      expect(st, 'host removes the guest').toBeLessThan(300)
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(1, { timeout: 30000 })
      // the guest opens the meeting address again (reload / back button): sent to the join page, not back in
      await guest.page.waitForTimeout(1500)
      await guest.page.goto(meetingUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
      await expect.poll(() => guest.page.url(), { timeout: 15000 }).toContain('/join/')
      await guest.page.waitForTimeout(3000)
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(1)
      // and the join link refuses this device
      const again = await guest.page.evaluate(code => fetch('/api/guest-join/' + code, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ display_name: 'Back Again', device_id: localStorage.getItem('tenet_device_id') }) }).then(async r => ({ s: r.status, b: await r.text() })), roomUuid)
      expect(again.s, again.b).toBe(403)
      expect(again.b).toContain('removed')
      // a different person on another device can still join
      const other = await H.joinAsGuest(roomUuid, 'Guest Other')
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await other.browser.close().catch(() => {})
    } finally {
      await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
      for (const p of [guest, host]) await p.browser.close().catch(() => {}); await api.close().catch(() => {})
    }
  })
})
