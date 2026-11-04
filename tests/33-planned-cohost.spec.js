// 33 - Planned co-host: Tenet staff the host picks in the schedule form become co-host on arrival with full powers,
// count as "the host is here" for guests, and only Tenet addresses on the invite list are kept. The form shows the
// Tenet addresses from the invite field as tick boxes.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const PLANNED = 'pc.one@tenetnetworks.com', OTHER = 'pc.two@tenetnetworks.com'

test.describe.serial('33 - Planned co-host', () => {
  test.setTimeout(150000)
  let m
  const people = []
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'planned-cohost')
    const r = await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: {
      invited_emails: `${PLANNED}, guest.person@example.com, ${OTHER}`,
      planned_cohosts: `${PLANNED}, guest.person@example.com, not.invited@tenetnetworks.com`,
    } })
    expect(r.status()).toBeLessThan(300)
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of people) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('only Tenet addresses on the invite list are kept', async () => {
    const list = await (await m.api.request.get(`${H.BASE_URL}/api/meetings`)).json()
    const row = list.find(x => x.id === m.meetingId)
    expect(row && row.planned_cohosts).toBe(PLANNED)
  })

  test('the planned co-host joins before the host: co-host with full powers, and guests can come in', async () => {
    const pc = await H.joinAsStaff(m.meetingId, PLANNED, 'Planned One'); people.push(pc)
    await expect.poll(async () => { const s = await H.meetingStatus(m.api, m.meetingId); return [s.moderator_email, Boolean(s.moderator_auto)] }, { timeout: 15000 }).toEqual([PLANNED, false])
    await expect(pc.page.locator('#btn-end-meeting'), 'full powers: End meeting shown').toBeVisible({ timeout: 20000 })
    const g = await (await m.api.request.post(`${H.BASE_URL}/api/guest-join/${m.roomUuid}`, { data: { display_name: 'Guest Lee', device_id: 'test-dev-lee-000001' } })).json()
    expect(g.waitingForHost, 'guests do not wait for the host when a planned co-host is in').toBeFalsy()
    expect(g.url || '').toMatch(/\/meeting\//)
  })

  test('other invited staff do not become co-host; the host joining keeps the planned co-host', async () => {
    const other = await H.joinAsStaff(m.meetingId, OTHER, 'Other Two'); people.push(other)
    const host = await H.joinAsHost(m.meetingId); people.push(host)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    await host.page.waitForTimeout(3000)                                   // let host-rejoined run
    const s = await H.meetingStatus(m.api, m.meetingId)
    expect([s.moderator_email, Boolean(s.moderator_auto)]).toEqual([PLANNED, false])
  })

  test('schedule form lists the Tenet addresses from the invite field', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    try {
      await page.goto(`${H.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => typeof window.openSchedule === 'function' && window.TenetPlannedCohost)
      await page.evaluate(() => openSchedule())
      await expect(page.locator('#mPlannedBox')).toContainText('Co-host (optional)')
      await page.locator('#mInvited').fill('a.b@tenetnetworks.com, client@example.com')
      await expect(page.locator('#mPlannedBox input[type=checkbox]')).toHaveCount(1)
      await page.locator('#mPlannedBox input[type=checkbox]').check()
      expect(await page.evaluate(() => TenetPlannedCohost.value())).toBe('a.b@tenetnetworks.com')
    } finally { await ctx.close() }
  })
})
