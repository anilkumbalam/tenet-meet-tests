// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

/*
  79 - Admin "All meetings" page (/admin/meetings)

  Locks in what the page must keep doing:
    - the details of a meeting: Host, Status, Started / Ended, Duration (2+ people), Peak participants,
      and per person: Person, Joined, Left, How they ended, Poor time
    - Live now / Upcoming / Past tabs and the summary cards
    - admin actions: copy link, reschedule, cancel (scheduled), end with a message (live)
    - every action is in the meeting's admin history, and non-admins cannot use the actions

  No real email is sent: every action here is run with notifications switched off.
*/

const BASE = H.BASE_URL
const MEMBER = process.env.MEMBER_EMAIL || 'pw-member55@tenetnetworks.com'   // not an admin (same account as test 55)

// A wall-clock time in IST, as the schedule form sends it: 'YYYY-MM-DDTHH:MM'
function istWall (msFromNow) {
  const d = new Date(Date.now() + msFromNow + 5.5 * 3600e3)
  return d.toISOString().slice(0, 16)
}

async function adminPage (browser) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  await H.setAuthCookie(ctx)
  const page = await ctx.newPage()
  await page.goto(`${BASE}/admin/meetings`, { waitUntil: 'domcontentloaded' })
  await expect(page.locator('#meetingsCard table, #meetingsCard .empty-note')).toBeVisible({ timeout: 15000 })
  return { ctx, page }
}

async function scheduleMeeting (api, title, msFromNow) {
  const r = await api.request.post(`${BASE}/api/meetings`, { data: { title, scheduled_at: istWall(msFromNow), duration_minutes: 30, timezone: 'Asia/Kolkata' } })
  expect(r.ok(), 'meeting created').toBeTruthy()
  return r.json()
}

test.describe('79 - admin All meetings', () => {
  test.describe.configure({ mode: 'serial' })
  const stamp = Date.now().toString(36)
  let api, created = []

  test.beforeAll(async ({ browser }) => {
    api = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(api)
  })
  test.afterAll(async () => {
    for (const id of created) await api.request.delete(`${BASE}/api/meetings/${id}`).catch(() => {})
    await api.close()
  })

  test('tabs and cards load; Past is the default tab', async ({ browser }) => {
    const { ctx, page } = await adminPage(browser)
    await expect(page.locator('.am-tab[data-tab="past"]')).toHaveAttribute('aria-selected', 'true')
    for (const id of ['#cardLive', '#cardUp', '#cardPast', '#cardAtt']) await expect(page.locator(id)).toHaveText(/^\d+$/)
    await page.locator('.am-tab[data-tab="upcoming"]').click()
    await expect(page.locator('#amPeriodRow')).toBeHidden()
    await page.locator('.am-tab[data-tab="past"]').click()
    await expect(page.locator('#amPeriodRow')).toBeVisible()
    await ctx.close()
  })

  test('upcoming: copy link, reschedule and cancel, all recorded in the admin history', async ({ browser }) => {
    const m = await scheduleMeeting(api, `T79 scheduled ${stamp}`, 3 * 864e5)
    created.push(m.id)
    const { ctx, page } = await adminPage(browser)
    await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE })
    await page.locator('.am-tab[data-tab="upcoming"]').click()
    const row = page.locator(`#meetingsCard tr[data-id="${m.id}"]`)
    await expect(row).toBeVisible({ timeout: 10000 })

    await row.locator('[data-act="copy"]').click()
    await expect(page.locator('#toast')).toHaveText('Link copied')
    expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/join\//)

    // Reschedule one day later, no email
    await row.locator('[data-act="reschedule"]').click()
    const newDay = istWall(4 * 864e5).slice(0, 10)
    await page.locator('#f-date').fill(newDay)
    await page.locator('#f-notify').uncheck()
    await page.locator('#dlg-ok').click()
    await expect(page.locator('#dlg')).toBeHidden({ timeout: 10000 })
    await expect(page.locator('#toast')).toHaveText('Meeting moved')
    let d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(d.admin_actions.map(a => a.action)).toContain('reschedule')

    // Cancel, no email; the meeting is kept as a record
    await page.locator(`#meetingsCard tr[data-id="${m.id}"] [data-act="cancel"]`).click()
    await page.locator('#f-notify').uncheck()
    await page.locator('#f-reason').fill('Test 79')
    await page.locator('#dlg-ok').click()
    await expect(page.locator('#toast')).toHaveText('Meeting cancelled', { timeout: 10000 })
    d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(d.meeting.status).toBe('ended')
    expect(d.admin_actions.map(a => a.action)).toEqual(['reschedule', 'cancel'])
    expect(d.admin_actions[1].detail.reason).toBe('Test 79')

    // Shown under Past as cancelled by an admin, with the history in its details
    await page.locator('.am-tab[data-tab="past"]').click()
    const past = page.locator(`#meetingsCard tr[data-id="${m.id}"]`)
    await expect(past).toContainText('Cancelled by admin')
    await past.locator('[data-act="details"]').click()
    await expect(page.locator('#panel-body')).toContainText('Cancelled by an administrator')
    await expect(page.locator('#panel-body')).toContainText('Rescheduled by an administrator')
    await ctx.close()
  })

  test('live: details show the people in it; End with a message reaches the meeting and ends it', async ({ browser }) => {
    const { meetingId, roomUuid } = await H.createMeeting(browser, 't79')
    created.push(meetingId)
    const host = await H.joinAsHost(meetingId)
    const guest = await H.joinAsGuest(roomUuid, 'T79 Guest')
    try {
      const { ctx, page } = await adminPage(browser)
      await page.locator('.am-tab[data-tab="live"]').click()
      const row = page.locator(`#meetingsCard tr[data-id="${meetingId}"]`)
      await expect(row).toBeVisible({ timeout: 15000 })

      // Details: the same fields as before, people still in the meeting shown as such
      await row.locator('[data-act="details"]').click()
      const body = page.locator('#panel-body')
      for (const text of ['Host:', 'Status:', 'Started:', 'Peak participants:']) await expect(body).toContainText(text)
      await expect(page.locator('#panel-body .parts-table thead')).toHaveText(/Person\s*Joined\s*Mic & camera\s*Left\s*How they ended\s*Poor time/)   // 18 Nov: live column
      await expect(body).toContainText('In the meeting')
      await expect(body).toContainText('T79 Guest')
      // what LiveKit says the guest is sending (the test browser has a fake mic)
      await expect(page.locator('#panel-body .parts-table tbody tr', { hasText: 'T79 Guest' })).toContainText(/Mic on|Mic muted|No mic/)
      await expect(body).toContainText('refreshes every 10 s')
      // 18 Nov: the guest's own page reports every 30 s (live-stats.js); the panel refreshes every 10 s
      await expect.poll(async () => (await page.locator('#panel-body .parts-table tbody tr', { hasText: 'T79 Guest' }).textContent()) || '',
        { message: 'the guest\'s page reports its connection', timeout: 75000, intervals: [5000] }).toMatch(/Connection (good|poor|lost)/)
      await page.locator('#panel-close').click()

      // End now, with a message, no email
      await row.locator('[data-act="end"]').click()
      await page.locator('#f-msg').fill('Test 79 is ending this meeting')
      await page.locator('input[name="f-when"][value="0"]').check()
      await page.locator('#f-email').uncheck()
      await page.locator('#dlg-ok').click()
      await expect(page.locator('#toast')).toHaveText('Meeting ended', { timeout: 15000 })

      // The guest saw the message (admin-notice.js on the meeting page), then the meeting closed
      await expect(guest.page.locator('#admin-notice')).toContainText('Test 79 is ending this meeting', { timeout: 10000 })
      await expect.poll(async () => (await H.meetingStatus(api, meetingId)).status, { timeout: 15000 }).toBe('ended')
      const d = await (await api.request.get(`${BASE}/api/admin/meetings/${meetingId}`)).json()
      expect(d.admin_actions.map(a => a.action)).toContain('end')
      await ctx.close()
    } finally {
      await host.browser.close().catch(() => {})
      await guest.browser.close().catch(() => {})
    }
  })

  test('past details keep every field of the original view', async ({ browser }) => {
    const { ctx, page } = await adminPage(browser)
    const first = page.locator('#meetingsCard tbody tr').filter({ hasText: 'Ended' }).first()
    await expect(first).toBeVisible({ timeout: 10000 })
    await first.locator('[data-act="details"]').click()
    const body = page.locator('#panel-body')
    for (const text of ['Host:', 'Status:', 'Started:', 'Ended:']) await expect(body).toContainText(text)
    await expect(body.locator('.parts-table thead, .empty-note').first()).toBeVisible()
    await ctx.close()
  })

  test('non-admins cannot see the page or use the actions', async ({ browser }) => {
    const m = await scheduleMeeting(api, `T79 guarded ${stamp}`, 5 * 864e5)
    created.push(m.id)
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(ctx, MEMBER, 'PW Member 79')
    for (const [path, body] of [['end', {}], ['cancel', { notify: false }], ['reschedule', { date: '2030-01-01', time: '10:00', notify: false }]]) {
      const r = await ctx.request.post(`${BASE}/api/admin/meetings/${m.id}/${path}`, { data: body })
      expect(r.status(), path).toBe(403)
    }
    expect((await ctx.request.get(`${BASE}/api/admin/meetings`)).status()).toBe(403)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/admin/meetings`)
    await expect(page).toHaveURL(/\/dashboard/)
    await ctx.close()
  })
  test('repeating meeting: one occurrence moves on its own; the next one stays in the series slot', async ({ browser }) => {
    test.setTimeout(180000)
    // Weekly on the weekday 2 days from now
    const wall = istWall(2 * 864e5)
    const weekday = new Date(wall + ':00Z').getUTCDay()
    const r = await api.request.post(`${BASE}/api/meetings`, { data: { title: `T79 series ${stamp}`, scheduled_at: wall, duration_minutes: 30, timezone: 'Asia/Kolkata', recurrence: 'weekly', recurrence_days: String(weekday) } })
    expect(r.ok(), 'series created').toBeTruthy()
    const m = await r.json()
    created.push(m.id)
    let d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(d.meeting.recurring).toBe(true)
    const slotMs = Date.parse(d.meeting.scheduled_at)

    // Past the next meeting in the series: refused
    const tooLate = istWall(9 * 864e5)
    let res = await api.request.post(`${BASE}/api/admin/meetings/${m.id}/reschedule`, { data: { date: tooLate.slice(0, 10), time: tooLate.slice(11, 16), notify: false } })
    expect(res.status()).toBe(400)

    // Move this occurrence one day later, no email: the series slot is kept
    const later = istWall(3 * 864e5)
    res = await api.request.post(`${BASE}/api/admin/meetings/${m.id}/reschedule`, { data: { date: later.slice(0, 10), time: later.slice(11, 16), notify: false } })
    expect(res.status()).toBe(200)
    d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(Date.parse(d.meeting.moved_from)).toBe(slotMs)
    expect(Date.parse(d.meeting.scheduled_at)).toBeGreaterThan(slotMs)

    // Shown as moved in Upcoming
    const { ctx, page } = await adminPage(browser)
    await page.locator('.am-tab[data-tab="upcoming"]').click()
    await expect(page.locator(`#meetingsCard tr[data-id="${m.id}"]`)).toContainText('Moved')
    await ctx.close()

    // Cancel it (no email); the background job then creates the next one, in the original weekly slot
    res = await api.request.post(`${BASE}/api/admin/meetings/${m.id}/cancel`, { data: { notify: false } })
    expect(res.status()).toBe(200)
    let next = null
    await expect.poll(async () => {
      const list = await (await api.request.get(`${BASE}/api/admin/meetings?period=7d`)).json()
      next = list.meetings.find(x => x.title === `T79 series ${stamp}` && x.status === 'scheduled' && x.id !== m.id) || null
      return Boolean(next)
    }, { message: 'next occurrence created by the background job', timeout: 130000, intervals: [5000] }).toBe(true)
    created.push(next.id)
    expect(Date.parse(next.scheduled_at)).toBe(slotMs + 7 * 864e5)
    expect(next.moved_from).toBeNull()
  })
  test('host: move only one meeting of a series, then cancel the whole series from the dashboard', async ({ browser }) => {
    test.setTimeout(240000)
    const wall = istWall(2 * 864e5)
    const weekday = new Date(wall + ':00Z').getUTCDay()
    const title = `T79 host series ${stamp}`
    const r = await api.request.post(`${BASE}/api/meetings`, { data: { title, scheduled_at: wall, duration_minutes: 30, timezone: 'Asia/Kolkata', recurrence: 'weekly', recurrence_days: String(weekday) } })
    expect(r.ok()).toBeTruthy()
    const m = await r.json()
    created.push(m.id)
    let d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    const slotMs = Date.parse(d.meeting.scheduled_at)

    // The host's own edit, "only this meeting": the series slot is kept
    const later = istWall(3 * 864e5)
    let res = await api.request.patch(`${BASE}/api/meetings/${m.id}`, { data: { scheduled_at: later.replace('T', ' ') + ':00', duration_minutes: 30, scope: 'one', notify: false } })
    expect(res.status()).toBe(200)
    d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(Date.parse(d.meeting.moved_from)).toBe(slotMs)

    // Past the next one in the series: refused with a clear message
    const tooLate = istWall(10 * 864e5)
    res = await api.request.patch(`${BASE}/api/meetings/${m.id}`, { data: { scheduled_at: tooLate.replace('T', ' ') + ':00', scope: 'one', notify: false } })
    expect(res.status()).toBe(400)
    expect((await res.json()).error).toMatch(/before the next meeting/)

    // Cancel the whole series from the dashboard: the dialog offers the choice
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/dashboard#upcoming`)
    const row = page.locator('.row', { hasText: title }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator('.more').click()
    await page.locator('.menu button', { hasText: 'Cancel meeting' }).click()
    const choices = page.locator('.dlg input[name="dlg-choice"]')
    await expect(choices).toHaveCount(2)
    await choices.nth(1).check()
    await page.locator('.dlg [data-a="1"]').click()
    await expect(page.locator('.dlg')).toHaveCount(0)
    await expect.poll(async () => (await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()).meeting.status, { timeout: 10000 }).toBe('ended')
    await ctx.close()

    // No new occurrence appears (the background job runs every minute)
    await new Promise(r => setTimeout(r, 75000))
    const list = await (await api.request.get(`${BASE}/api/admin/meetings?period=7d`)).json()
    expect(list.meetings.filter(x => x.title === title && x.status === 'scheduled')).toHaveLength(0)
  })

  test('admin: move this and all following, then cancel the series', async () => {
    const wall = istWall(2 * 864e5)
    const weekday = new Date(wall + ':00Z').getUTCDay()
    const r = await api.request.post(`${BASE}/api/meetings`, { data: { title: `T79 admin series ${stamp}`, scheduled_at: wall, duration_minutes: 30, timezone: 'Asia/Kolkata', recurrence: 'weekly', recurrence_days: String(weekday) } })
    expect(r.ok()).toBeTruthy()
    const m = await r.json()
    created.push(m.id)
    const later = istWall(2 * 864e5 + 2 * 3600e3)
    let res = await api.request.post(`${BASE}/api/admin/meetings/${m.id}/reschedule`, { data: { date: later.slice(0, 10), time: later.slice(11, 16), notify: false, scope: 'following' } })
    expect(res.status()).toBe(200)
    expect((await res.json()).scope).toBe('following')
    let d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(d.meeting.moved_from).toBeNull()
    res = await api.request.post(`${BASE}/api/admin/meetings/${m.id}/cancel`, { data: { notify: false, scope: 'series' } })
    expect(res.status()).toBe(200)
    const body = await res.json()
    expect(body.scope).toBe('series')
    expect(body.cancelled).toBeGreaterThanOrEqual(1)
    d = await (await api.request.get(`${BASE}/api/admin/meetings/${m.id}`)).json()
    expect(d.meeting.status).toBe('ended')
    expect(d.admin_actions.map(a => a.detail.scope)).toEqual(['following', 'series'])
  })
})
