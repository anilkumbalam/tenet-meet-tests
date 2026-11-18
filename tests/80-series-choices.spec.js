// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

/*
  80 - Repeating meetings, every choice (18 Nov)

  Six weekly test series, each first meeting at 10:00 IST two days from now. Changes are made through the real pages
  (the host's dashboard edit form and Cancel menu, the admin page's dialog), then the background job is awaited once
  and each series' next meeting is checked: day, time and length.

    oneMove      host edit form: new time, "Only this meeting"       -> moved, its usual slot kept
    following    host edit form: new time, "This and all following"  -> next meeting at the new time
    cancelOne    host Cancel: "Only this meeting"                     -> the series carries on in its usual slot
    day          host edit form: weekday changed (no question asked)  -> next meeting on the new day
    length       host edit form: 30 min, "Only this meeting"          -> next meeting back to 60 min
    adminCancel  admin page Cancel: "Only this meeting" (default)     -> the series carries on in its usual slot

  No email is sent: the series have no invitees, and the admin cancel is made with notifications off.
*/

const BASE = H.BASE_URL
const DAY = 864e5
const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const istDate = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10)

test.describe('80 - repeating meetings, every choice', () => {
  test.describe.configure({ mode: 'serial' })
  const stamp = Date.now().toString(36)
  const date = istDate(Date.now() + 2 * DAY)                  // first meeting of each series
  const X = new Date(date + 'T00:00:00Z').getUTCDay()          // its weekday
  const Y = (X + 1) % 7                                        // the next weekday (for the day change)
  const slotMs = Date.parse(date + 'T10:00:00+05:30')
  const S = {}
  const created = []
  let api

  test.beforeAll(async ({ browser }) => {
    api = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(api)
    for (const k of ['oneMove', 'following', 'cancelOne', 'day', 'length', 'adminCancel']) {
      const title = `T80 ${k} ${stamp}`
      const r = await api.request.post(`${BASE}/api/meetings`, { data: { title, scheduled_at: date + 'T10:00', duration_minutes: 60, timezone: 'Asia/Kolkata', recurrence: 'weekly', recurrence_days: String(X) } })
      expect(r.ok(), 'create ' + k).toBeTruthy()
      S[k] = { id: (await r.json()).id, title }
      created.push(S[k].id)
    }
  })

  test.afterAll(async () => {
    const list = await api.request.get(`${BASE}/api/admin/meetings?period=30d`).then(r => r.json()).catch(() => ({ meetings: [] }))
    for (const m of (list.meetings || []).filter(x => String(x.title).startsWith('T80 ') && String(x.title).endsWith(stamp))) created.push(m.id)
    for (const id of new Set(created)) await api.request.delete(`${BASE}/api/meetings/${id}`).catch(() => {})
    await api.close()
  })

  const detail = async id => (await api.request.get(`${BASE}/api/admin/meetings/${id}`)).json()
  const cancelOneByApi = async id => expect((await api.request.post(`${BASE}/api/meetings/${id}/cancel`, { data: { scope: 'one' } })).status(), 'cancel this one').toBe(204)

  async function dashboard (browser) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: 'Asia/Kolkata' })
    await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/dashboard#upcoming`)
    return { ctx, page }
  }
  async function rowMenu (page, title, item) {
    const row = page.locator('.row', { hasText: title }).first()
    await expect(row, title + ' listed').toBeVisible({ timeout: 15000 })
    await row.locator('.more').click()
    await page.locator('.menu button', { hasText: item }).click()
  }
  async function choose (page, value) {
    const c = page.locator(`.dlg input[name="dlg-choice"][value="${value}"]`)
    await expect(c, 'the dialog offers "' + value + '"').toHaveCount(1)
    await c.check()
    await page.locator('.dlg [data-a="1"]').click()
    await expect(page.locator('.dlg')).toHaveCount(0)
  }

  test('host, edit form: new time, "Only this meeting": moved, its usual slot kept', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser)
    await rowMenu(page, S.oneMove.title, 'Edit')
    await page.locator('#mTimeOnly').fill('11:00')
    await page.locator('#schedBtn').click()
    await choose(page, 'one')
    await expect.poll(async () => (await detail(S.oneMove.id)).meeting.moved_from, { timeout: 10000 }).not.toBeNull()
    const d = await detail(S.oneMove.id)
    expect(Date.parse(d.meeting.moved_from), 'usual slot kept').toBe(slotMs)
    expect(Date.parse(d.meeting.scheduled_at), 'this meeting at 11:00').toBe(slotMs + 3600e3)
    await ctx.close()
  })

  test('host, edit form: new time, "This and all following"', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser)
    await rowMenu(page, S.following.title, 'Edit')
    await page.locator('#mTimeOnly').fill('11:00')
    await page.locator('#schedBtn').click()
    await choose(page, 'following')
    await expect.poll(async () => Date.parse((await detail(S.following.id)).meeting.scheduled_at), { timeout: 10000 }).toBe(slotMs + 3600e3)
    expect((await detail(S.following.id)).meeting.moved_from, 'no usual slot kept: the series moved').toBeNull()
    await ctx.close()
    await cancelOneByApi(S.following.id)   // so the background job creates the next one (checked at the end)
  })

  test('host, Cancel: "Only this meeting"', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser)
    await rowMenu(page, S.cancelOne.title, 'Cancel meeting')
    await choose(page, 'one')
    await expect.poll(async () => (await detail(S.cancelOne.id)).meeting.status, { timeout: 10000 }).toBe('ended')
    await ctx.close()
  })

  test('host, edit form: weekday changed; no question, since the date and time stay', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser)
    await rowMenu(page, S.day.title, 'Edit')
    await page.locator(`#recurDays .day-chip[title="${NAMES[Y]}"]`).click()
    await page.locator(`#recurDays .day-chip[title="${NAMES[X]}"]`).click()
    await expect(page.locator('#recurSummary')).toContainText('Repeats every ' + NAMES[Y])
    await page.locator('#schedBtn').click()
    await expect(page.locator('.dlg'), 'no one-or-series question').toHaveCount(0)
    await expect.poll(async () => {
      const mine = await (await api.request.get(`${BASE}/api/meetings`)).json()
      const m = (Array.isArray(mine) ? mine : mine.meetings || []).find(x => x.id === S.day.id)
      return m && String(m.recurrence_days)
    }, { timeout: 10000 }).toBe(String(Y))
    await ctx.close()
    await cancelOneByApi(S.day.id)
  })

  test('host, edit form: 30 minutes, "Only this meeting"', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser)
    await rowMenu(page, S.length.title, 'Edit')
    await page.locator('#mDuration').selectOption('30')
    await page.locator('#schedBtn').click()
    await choose(page, 'one')
    await expect.poll(async () => (await detail(S.length.id)).meeting.duration_minutes, { timeout: 10000 }).toBe(30)
    await ctx.close()
    await cancelOneByApi(S.length.id)
  })

  test('admin page, Cancel: "Only this meeting" is the default choice', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${BASE}/admin/meetings`)
    await page.locator('.am-tab[data-tab="upcoming"]').click()
    const row = page.locator(`#meetingsCard tr[data-id="${S.adminCancel.id}"]`)
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator('[data-act="cancel"]').click()
    await expect(page.locator('input[name="f-scope"][value="one"]'), '"Only this meeting" preselected').toBeChecked()
    await expect(page.locator('input[name="f-scope"][value="series"]')).toHaveCount(1)
    await page.locator('#f-notify').uncheck()
    await page.locator('#dlg-ok').click()
    await expect(page.locator('#toast')).toHaveText('Meeting cancelled', { timeout: 10000 })
    await ctx.close()
  })

  test('the background job creates each next meeting where the choice says', async () => {
    test.setTimeout(200000)
    const want = {
      following: { ms: slotMs + 3600e3 + 7 * DAY, dur: 60 },   // the series moved to 11:00
      cancelOne: { ms: slotMs + 7 * DAY, dur: 60 },             // carries on in its usual slot
      day: { ms: slotMs + DAY, dur: 60 },                        // now on the next weekday
      length: { ms: slotMs + 7 * DAY, dur: 60 },                 // back to the series length
      adminCancel: { ms: slotMs + 7 * DAY, dur: 60 }
    }
    const found = {}
    await expect.poll(async () => {
      const list = (await (await api.request.get(`${BASE}/api/admin/meetings?period=7d`)).json()).meetings
      for (const k of Object.keys(want)) {
        const n = list.find(x => x.title === S[k].title && x.status === 'scheduled' && x.id !== S[k].id)
        if (n) found[k] = n
      }
      return Object.keys(found).sort()
    }, { message: 'next meetings created', timeout: 150000, intervals: [5000] }).toEqual(Object.keys(want).sort())
    for (const [k, w] of Object.entries(want)) {
      created.push(found[k].id)
      expect(Date.parse(found[k].scheduled_at), k + ': day and time').toBe(w.ms)
      expect(found[k].duration_minutes, k + ': length').toBe(w.dur)
      expect(found[k].moved_from, k + ': a fresh meeting, nothing moved').toBeNull()
    }
  })
})
