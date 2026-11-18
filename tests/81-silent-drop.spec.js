// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

/*
  81 - Host drops without their page saying so (18 Nov, webhook stage 3)

  The host's network is cut (no "I'm leaving" from the page, as with a lost connection or a crashed laptop). LiveKit
  notices the host is gone and tells the server (participant_left); after its 15 s wait the webhook marks the host left
  and runs the same hand-over as a normal leave: Tenet staff in the meeting become co-host with limited powers.
  Before stage 3 nobody was promoted in this case. The normal leave is covered by 24, 30 and 48.
*/

const STAFF = 'cohost.test@tenetnetworks.com'

test.describe('81 - silent drop', () => {
  test('host loses the connection: staff promoted automatically, guests see it', async ({ browser }) => {
    test.setTimeout(300000)
    const m = await H.createMeeting(browser, 't81')
    const host = await H.joinAsHost(m.meetingId)
    const staff = await H.joinAsStaff(m.meetingId, STAFF, 'Cohost Test')
    const guest = await H.joinAsGuest(m.roomUuid, 'T81 Guest')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      let s = await H.meetingStatus(m.api, m.meetingId)
      expect(s.moderator_email || null, 'no co-host while the host is in').toBeNull()

      // The host's network goes: no leave call, no heartbeats, the media connection times out
      await host.ctx.setOffline(true)

      // Whichever notices first runs the hand-over: the webhook (LiveKit gives up on the host, then 15 s) or the
      // heartbeat cleanup (90 s without a heartbeat, checked every minute): at most about 2.5 minutes
      await expect.poll(async () => { const st = await H.meetingStatus(m.api, m.meetingId); return [st.moderator_email || null, Boolean(st.moderator_auto)] },
        { message: 'staff promoted after the silent drop', timeout: 180000, intervals: [3000] }).toEqual([STAFF, true])

      // The staff member's page shows it: limited powers, so no End button
      await expect.poll(() => staff.page.evaluate(() => { const b = document.getElementById('btn-end-meeting'); return b ? getComputedStyle(b).display : 'missing' }),
        { message: 'automatic co-host has no End', timeout: 30000 }).toBe('none')

      // The meeting carries on for the others
      await expect(guest.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    } finally {
      for (const p of [host, staff, guest]) await p.browser.close().catch(() => {})
      await m.api.request.delete(`${H.BASE_URL}/api/meetings/${m.meetingId}`).catch(() => {})
      await m.api.close().catch(() => {})
    }
  })
})
