// 47 - The host leaves through the hand-over dialog and is really out (bug found 6 Nov evening).
// Before the fix: Leave -> Leave meeting -> hand-over dialog -> Leave meeting set the co-host, but the dialog's
// own Leave click only reopened the Leave menu, so the host stayed in the meeting until they clicked Leave again.
// Checked with the clicks a person makes: the host lands on "You left the meeting" at once; the guest carries on as co-host.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

const ended = page => page.evaluate(() => { const e = document.getElementById('ended-screen'); return e && e.classList.contains('show') ? (e.querySelector('h2') || {}).textContent : 'still in' })

async function setup (browser, prefix) {
  const m = await H.createMeeting(browser, prefix)
  const host = await H.joinAsHost(m.meetingId)
  const guest = await H.joinAsGuest(m.roomUuid, 'Guest Takeover')
  await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  return Object.assign(m, { host, guest })
}
async function teardown (m) {
  if (!m) return
  if (m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
  for (const p of [m.host, m.guest]) if (p) await p.browser.close().catch(() => {})
  if (m.api) await m.api.close().catch(() => {})
}
async function leaveThroughMenu (page) {
  await page.locator('#btn-end').click()
  await expect(page.locator('#tb-leave-menu')).toBeVisible({ timeout: 5000 })
  await page.locator('#tb-leave-only').click()
  await expect(page.locator('#hl-dialog')).toBeVisible({ timeout: 10000 })
}
async function hostIsOut (m) {
  await expect.poll(() => ended(m.host.page), { timeout: 10000 }).toBe('You left the meeting')
  await expect(m.host.page.locator('#tb-leave-menu')).toBeHidden()                                   // the menu did not reopen
  await expect(m.guest.page.locator('#video-grid .video-tile')).toHaveCount(1, { timeout: 20000 })    // the guest sees the host gone
  await expect.poll(async () => { const s = await H.meetingStatus(m.api, m.meetingId); return s.moderator_identity || s.moderator_pid || s.moderator_email || null }, { timeout: 15000 }).not.toBeNull()
  await expect(m.guest.page.locator('#btn-mute-all')).toBeVisible({ timeout: 15000 })                 // the guest now has co-host powers
  expect(await ended(m.guest.page)).toBe('still in')                                                   // and the meeting goes on
}

test.describe('47 - Host leaves with a hand-over', () => {

  test.setTimeout(180000)

  test('no co-host yet: choose the guest, Leave meeting -> the host is out at once, the guest is co-host', async ({ browser }) => {
    let m
    try {
      m = await setup(browser, 'leave-pick')
      await leaveThroughMenu(m.host.page)
      const pick = m.host.page.locator('#hl-dialog input[name="hl-who"]').first()
      await pick.check()
      await m.host.page.locator('#hl-go').click()
      await hostIsOut(m)
    } finally { await teardown(m) }
  })

  test('guest already co-host: "will take over", Leave meeting -> the host is out at once', async ({ browser }) => {
    let m
    try {
      m = await setup(browser, 'leave-co')
      const p = m.host.page
      await H.openPanel(p)
      const row = p.locator('.participant-item').filter({ hasText: 'Guest Takeover' })
      await H.openRowMenu(row)
      await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).dispatchEvent('click')
      await expect(m.guest.page.locator('#btn-mute-all')).toBeVisible({ timeout: 15000 })
      await leaveThroughMenu(p)
      await expect(p.locator('#hl-dialog')).toContainText('is co-host and will take over')
      await p.locator('#hl-go').click()
      await hostIsOut(m)
    } finally { await teardown(m) }
  })
})
