// 24 - Co-host rules: the host's leave dialog (hand over or end for everyone), the per-meeting "If I drop out"
// setting (staff first / staff only / nobody), and limited powers for a co-host promoted automatically.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const STAFF = 'cohost.test@tenetnetworks.com'
const idOf = p => p.page.evaluate(() => window.__tenetRoom.localParticipant.identity)
const endedTitle = page => page.evaluate(() => { const e = document.getElementById('ended-screen'); return e && e.classList.contains('show') ? e.querySelector('h2').textContent : 'still in' })
const asPage = (page, method, path) => page.evaluate(([m, u]) => fetch(u, { method: m, headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status), [method, path])

async function meeting (browser, prefix, autoCohost) {
  const m = await H.createMeeting(browser, prefix)
  if (autoCohost) expect((await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: { auto_cohost: autoCohost } })).status()).toBeLessThan(300)
  return m
}
async function cleanup (m, people) {
  await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
  for (const p of people) if (p) await p.browser.close().catch(() => {})
  await m.api.close().catch(() => {})
}

test.describe.serial('24 - Co-host rules', () => {
  test.setTimeout(180000)

  test('dashboard: "If I drop out" setting is offered, saved and changed', async ({ browser }) => {
    const m = await meeting(browser, 'cohost-setting', 'staff_only')
    try {
      const list = await (await m.api.request.get(`${H.BASE_URL}/api/meetings`)).json()
      expect((list.find(x => x.id === m.meetingId) || {}).auto_cohost).toBe('staff_only')
      await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: { auto_cohost: 'none' } })
      await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: { auto_cohost: 'anything else' } })   // ignored
      const list2 = await (await m.api.request.get(`${H.BASE_URL}/api/meetings`)).json()
      expect((list2.find(x => x.id === m.meetingId) || {}).auto_cohost).toBe('none')
      const page = await m.api.newPage()
      await page.goto(`${H.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => typeof window.openSchedule === 'function' && window.TenetCohost)
      const opts = await page.evaluate(() => { openSchedule(); return [...document.getElementById('mAutoCohost').options].map(o => o.value + '=' + o.selected) })
      expect(opts).toEqual(['staff_guests=true', 'staff_only=false', 'none=false'])
      await page.close()
    } finally { await cleanup(m, []) }
  })

  test('host leaves on purpose and hands over to a guest: that co-host has full powers', async ({ browser }) => {
    const m = await meeting(browser, 'handover')
    const host = await H.joinAsHost(m.meetingId)
    const staff = await H.joinAsStaff(m.meetingId, STAFF, 'Cohost Staff')
    const guest = await H.joinAsGuest(m.roomUuid, 'Guest Chosen')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      const gid = await idOf(guest), sid = await idOf(staff)
      await host.page.locator('#btn-end').click()
      await expect(host.page.locator('#hl-dialog')).toBeVisible({ timeout: 5000 })
      expect(await host.page.locator('#hl-dialog input[name="hl-who"]:checked').getAttribute('value'), 'Tenet staff preselected').toBe(sid)
      await host.page.locator(`#hl-dialog input[value="${gid}"]`).check()
      await host.page.locator('#hl-go').click()
      await expect.poll(async () => { const s = await H.meetingStatus(m.api, m.meetingId); return [s.moderator_identity, s.moderator_auto] }, { timeout: 20000 }).toEqual([gid, false])
      await expect(guest.page.locator('#btn-end-meeting'), 'chosen co-host can end').toBeVisible({ timeout: 20000 })
      expect(await asPage(guest.page, 'POST', `/api/meetings/${m.meetingId}/kick/${encodeURIComponent(sid)}`), 'chosen co-host can remove').toBeLessThan(300)
      await H.expectHealthy(guest)
    } finally { await cleanup(m, [guest, staff, host]) }
  })

  test('host ends the meeting for everyone from the leave dialog', async ({ browser }) => {
    const m = await meeting(browser, 'dialog-end')
    const host = await H.joinAsHost(m.meetingId), guest = await H.joinAsGuest(m.roomUuid, 'Guest Ends')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await host.page.locator('#btn-end').click()
      await host.page.locator('#hl-end').click()
      await expect.poll(() => endedTitle(guest.page), { timeout: 10000 }).toBe('Meeting Ended')
    } finally { await cleanup(m, [guest, host]) }
  })

  test('host drops out without choosing: Tenet staff promoted automatically, with limited powers', async ({ browser }) => {
    const m = await meeting(browser, 'auto-limited')
    const host = await H.joinAsHost(m.meetingId)
    const guest = await H.joinAsGuest(m.roomUuid, 'Guest First')          // joined before the staff member
    const staff = await H.joinAsStaff(m.meetingId, STAFF, 'Cohost Staff')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      const gid = await idOf(guest)
      await host.page.goto('about:blank')                                   // tab closed, no dialog
      await expect.poll(async () => { const s = await H.meetingStatus(m.api, m.meetingId); return [s.moderator_email, s.moderator_auto] }, { timeout: 30000 }).toEqual([STAFF, true])
      await expect.poll(() => staff.page.evaluate(() => getComputedStyle(document.getElementById('btn-end-meeting')).display), { timeout: 20000 }).toBe('none')
      expect(await asPage(staff.page, 'POST', `/api/meetings/${m.meetingId}/end`), 'automatic co-host cannot end').toBe(403)
      expect(await asPage(staff.page, 'POST', `/api/meetings/${m.meetingId}/kick/${encodeURIComponent(gid)}`), 'automatic co-host cannot remove').toBe(403)
      expect(await asPage(staff.page, 'POST', `/api/meetings/${m.meetingId}/lock`), 'but can still lock').toBeLessThan(300)
      expect((await H.meetingStatus(m.api, m.meetingId)).status).toBe('active')
      await H.expectHealthy(staff, guest)
    } finally { await cleanup(m, [staff, guest, host]) }
  })

  test('"Tenet staff only" and only guests present: nobody is promoted when the host drops out', async ({ browser }) => {
    const m = await meeting(browser, 'staff-only', 'staff_only')
    const host = await H.joinAsHost(m.meetingId), guest = await H.joinAsGuest(m.roomUuid, 'Guest Only')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await host.page.goto('about:blank')
      await guest.page.waitForTimeout(8000)
      const s = await H.meetingStatus(m.api, m.meetingId)
      expect(s.moderator_pid || null, 'no co-host').toBeNull()
      expect(s.status).toBe('active')
      expect(await guest.page.evaluate(() => getComputedStyle(document.getElementById('btn-end-meeting')).display)).toBe('none')
    } finally { await cleanup(m, [guest, host]) }
  })
})
