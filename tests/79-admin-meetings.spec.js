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
      await expect(page.locator('#panel-body .parts-table thead')).toHaveText(/Person\s*Joined\s*Left\s*How they ended\s*Poor time/)
      await expect(body).toContainText('In the meeting')
      await expect(body).toContainText('T79 Guest')
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
})
