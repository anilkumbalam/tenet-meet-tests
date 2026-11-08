// 27 - Dashboard tidy-ups and the in-meeting co-host setting: no "Join meeting" box; the schedule form reads
// "If the host drops out, co-host control goes to"; during a meeting only the host sees that setting (People panel),
// can change it, and the change is saved for the meeting (covers Start Now meetings, which have no form).
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test.describe.serial('27 - Dashboard and in-meeting co-host setting', () => {
  test.setTimeout(120000)

  test('dashboard: no Join box; schedule form label', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    try {
      await page.goto(`${H.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => typeof window.openSchedule === 'function' && window.TenetCohost)
      await expect(page.locator('#joinInput')).toHaveCount(0)
      await page.evaluate(() => openSchedule())
      await expect(page.locator('label[for="mAutoCohost"]')).toContainText('If the host drops out, co-host control goes to')
    } finally { await ctx.close() }
  })

  test('in a meeting, only the host sees the setting and can change it', async ({ browser }) => {
    const { meetingId, roomUuid, api } = await H.createMeeting(browser, 'cohost-control')
    const host = await H.joinAsHost(meetingId), guest = await H.joinAsGuest(roomUuid, 'Guest Control')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      for (const p of [host.page, guest.page]) { await H.openPanel(p); await p.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people')) }
      await H.openHostSettings(host.page)
      const sel = host.page.locator('#cc-select')
      await expect(sel).toBeVisible({ timeout: 15000 })
      await expect(sel).toHaveValue('staff_guests')
      await sel.selectOption('staff_only')
      await expect.poll(async () => {
        const list = await (await api.request.get(`${H.BASE_URL}/api/meetings`)).json()
        return (list.find(m => m.id === meetingId) || {}).auto_cohost
      }, { timeout: 10000 }).toBe('staff_only')
      await guest.page.waitForTimeout(2500)
      await expect(guest.page.locator('#cc-row'), 'guests do not see it').toHaveCount(0)
      expect(await guest.page.evaluate(id => fetch('/api/meetings/' + id, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{"auto_cohost":"none"}' }).then(r => r.status), meetingId), 'guest cannot change it').toBeGreaterThanOrEqual(400)
      await H.expectHealthy(host, guest)
    } finally {
      await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
      for (const p of [guest, host]) await p.browser.close().catch(() => {}); await api.close().catch(() => {})
    }
  })
})
