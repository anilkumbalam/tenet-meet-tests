// 41 - Stuck reconnect (real meeting, 5 Nov: a laptop's network was suspended; the media library got stuck
// "reconnecting" and the tab showed a frozen meeting). The watch shows "Reconnecting…" after 3 s and "Connection
// lost" with Rejoin when it does not recover (60 s; shortened here). A connected page shows neither, and leaving on
// purpose never shows the bar (6 Nov: conn-watch.js?v=3 acts only on `reconnecting`, not on the `disconnected`
// state a page passes through while it leaves).
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test.describe.serial('41 - Stuck reconnect', () => {
  test.setTimeout(120000)
  let m, host, guest
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'conn-watch')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Stuck')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('connected: no bar, no Connection lost', async () => {
    await guest.page.waitForTimeout(4000)
    await expect(guest.page.locator('#cw-bar')).toHaveCount(0)
    await expect(guest.page.locator('#rj-screen')).toHaveCount(0)
  })

  test('leaving on purpose: no "Reconnecting…" bar, no Connection lost', async () => {
    const leaver = await H.joinAsGuest(m.roomUuid, 'Guest Leaves')
    try {
      const p = leaver.page
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      // Record any appearance of the bar or the Connection lost screen, even a brief one, and even if the page
      // moves on after leaving (the binding survives navigation; the init script re-arms the watcher).
      const seen = []
      await p.exposeBinding('__t41Seen', (_src, what) => { seen.push(what) })
      const arm = () => {
        const check = () => {
          if (document.getElementById('cw-bar')) window.__t41Seen('cw-bar')
          if (document.getElementById('rj-screen')) window.__t41Seen('rj-screen')
        }
        new MutationObserver(check).observe(document.documentElement, { childList: true, subtree: true })
        check()
      }
      await p.addInitScript(arm)
      await p.evaluate(arm)
      p.on('dialog', d => d.accept().catch(() => {}))     // in case the page ever asks to confirm
      await p.locator('#btn-end').click()                 // a guest leaves directly (test 34)
      await expect(host.page.locator('#video-grid .video-tile'), 'the guest really left').toHaveCount(2, { timeout: 30000 })
      await p.waitForTimeout(6000)                        // the bar would show after 3 s of a bad state
      expect(seen, 'no Reconnecting bar or Connection lost after Leave').toEqual([])
    } finally {
      await leaver.browser.close().catch(() => {})
    }
  })

  test('stuck reconnecting: "Reconnecting…" bar, then Connection lost with Rejoin', async () => {
    const p = guest.page
    await p.evaluate(() => { window.__tenetWatchMs = 8000; window.__tenetRoom.state = 'reconnecting' })
    await expect(p.locator('#cw-bar')).toContainText('Reconnecting', { timeout: 8000 })
    await expect(p.locator('#rj-screen')).toBeVisible({ timeout: 15000 })
    await expect(p.locator('#rj-go')).toBeVisible()
    await expect(p.locator('#cw-bar')).toHaveCount(0)
  })
})
