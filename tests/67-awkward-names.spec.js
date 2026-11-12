// 67 - Awkward names and titles (9 Nov). Meeting titles and guest names that often break pages: apostrophes and &,
// markup typed as text, emoji, Hindi and Telugu, very long, and an empty title. Each must show exactly as typed (as
// text, never as markup), keep the layout intact on desktop and phone, and survive the guest page, the waiting count
// and the People list inside a meeting.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const RUN = Date.now().toString(36)
const HOST = { email: 'pwx-host67-' + RUN + '@tenetnetworks.com', name: 'PWX Host' }
const pass = () => jwt.sign({ email: HOST.email, displayName: HOST.name, isAdmin: false }, KEY, { expiresIn: '1h' })
const IST = 'Asia/Kolkata'
const wall = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: IST, hour12: false }).slice(0, 16) + ':00'
const TITLES = [
  "O'Brien & Sons: Q4 review " + RUN,
  '<b>bold</b> <i>planning</i> ' + RUN,
  'Launch 🚀 party 🎉 ' + RUN,
  'बैठक: बिक्री समीक्षा ' + RUN,
  'సమావేశం: అమ్మకాల సమీక్ష ' + RUN,
  ('Very long title about the regional distributor onboarding programme ' + RUN + ' ').padEnd(80, 'x').slice(0, 80),
]
const NAMES = ["Seán O'Brien", 'Priya 😀', 'రవి కుమార్', 'राहुल शर्मा', 'A'.repeat(55)]

test.describe.serial('67 - Awkward names and titles', () => {
  test.setTimeout(240000)
  let api
  const made = [], open = []
  test.beforeAll(async () => { api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } }) })
  test.afterAll(async () => {
    for (const x of open) await x.browser.close().catch(() => {})
    for (const id of made) { await api.post('/api/meetings/' + id + '/end').catch(() => {}); await api.delete('/api/meetings/' + id).catch(() => {}) }
    await api.dispose()
  })
  const mk = async (title, extra) => {
    const r = await api.post('/api/meetings', { data: Object.assign({ title, scheduled_at: wall(Date.now() + 26 * 3600000), timezone: IST, duration_minutes: 30 }, extra) })
    return { r, m: r.ok() ? await r.json() : null }
  }
  async function dashboard (browser, device) {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST, ...device })
    await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
    const page = await ctx.newPage()
    await page.goto(BASE + '/dashboard#upcoming')
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.evaluate(() => window.showTab('upcoming'))
    return { ctx, page }
  }

  test('titles are saved and shown exactly as typed, as text, on desktop and phone', async ({ browser }) => {
    for (const t of TITLES) { const { r, m } = await mk(t); expect(r.ok(), 'create "' + t + '" (' + r.status() + ')').toBe(true); made.push(m.id) }
    for (const [label, device] of [['desktop', H.DESKTOP], ['phone', H.PHONE]]) {
      const d = await dashboard(browser, device)
      await expect.poll(() => d.page.locator('.meeting-title').filter({ hasText: RUN }).count(), { timeout: 15000 }).toBe(TITLES.length)
      const shown = await d.page.evaluate(run => [...document.querySelectorAll('.meeting-title')].filter(e => e.textContent.includes(run)).map(e => ({
        text: e.textContent, markup: e.querySelector('b, i') !== null,
        row: (r => ({ h: Math.round(r.getBoundingClientRect().height), over: r.scrollWidth - r.clientWidth }))(e.closest('.row'))
      })), RUN)
      for (const t of TITLES) {
        const s = shown.find(x => x.text === t)
        expect(s, label + ': shown exactly: ' + t).toBeTruthy()
        expect(s.markup, label + ': typed markup stays text').toBe(false)
        expect(s.row.over, label + ': nothing sticks out of the row: ' + t).toBeLessThanOrEqual(1)
        expect(s.row.h, label + ': the row keeps a sensible height: ' + t).toBeLessThan(label === 'phone' ? 260 : 140)
      }
      expect(await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), label + ': no sideways scrolling').toBeLessThanOrEqual(1)
      await d.ctx.close()
    }
  })

  test('a blank title: on create it becomes "Quick Meeting"; on edit it is refused and the old title stays', async () => {
    const { r, m } = await mk('   ')
    expect(r.status(), 'create answers').toBe(200); made.push(m.id)
    const titleOf = async id => ((await (await api.get('/api/meetings?with=invited')).json()).find(x => x.id === id) || {}).title
    expect(await titleOf(m.id), 'blank becomes the Start-now name').toBe('Quick Meeting')
    const e = await api.patch('/api/meetings/' + m.id, { data: { title: '   ' } })
    expect(e.status(), 'blank title on edit is refused').toBe(400)
    expect((await e.json()).error).toBe('Please give the meeting a title')
    const t = await api.patch('/api/meetings/' + m.id, { data: { title: '  Trimmed ' + RUN + '  ' } })
    expect(t.ok(), 'a real title is accepted').toBe(true)
    expect(await titleOf(m.id), 'and saved without the stray spaces').toBe('Trimmed ' + RUN)
  })

  test('guest page: the title exactly as typed; guests with awkward names are counted by name', async ({ browser }) => {
    const m = (await mk(TITLES[1], {})).m; made.push(m.id)
    const pages = []
    for (const n of NAMES) {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST }); const p = await ctx.newPage(); pages.push(ctx)
      await p.goto(BASE + '/join/' + m.room_uuid); await p.locator('#n').fill(n); await p.locator('#btn').click()
      await expect(p.locator('#waiting'), n + ' waits').toBeVisible({ timeout: 20000 })
      if (n === NAMES[0]) {
        await expect(p.locator('#meet-title')).toHaveText(TITLES[1])
        expect(await p.locator('#meet-title b, #meet-title i').count(), 'typed markup stays text on the guest page').toBe(0)
      }
    }
    await expect.poll(async () => {
      const list = await (await api.get('/api/meetings?with=invited')).json()
      const row = list.find(x => x.id === m.id) || {}
      return [Number(row.waiting_count) || 0, (row.waiting_names || []).slice().sort().join('|')]
    }, { message: 'the host sees each guest once, by name', timeout: 20000 }).toEqual([NAMES.length, NAMES.slice().sort().join('|')])
    for (const c of pages) await c.close()
  })

  test('in the meeting: the People list shows awkward names exactly', async ({ browser }) => {
    const m = await H.createMeeting(browser, 't67-names')                 // an open meeting of the suite's host, who joins it
    const host = await H.joinAsHost(m.meetingId); open.push(host)
    for (const n of NAMES.slice(1, 4)) open.push(await H.joinAsGuest(m.roomUuid, n))
    await H.openPanel(host.page)
    for (const n of NAMES.slice(1, 4)) await expect(host.page.locator('#right-panel'), 'People shows ' + n).toContainText(n, { timeout: 20000 })
    expect(await host.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no sideways scrolling').toBeLessThanOrEqual(1)
    await m.api.request.post(BASE + '/api/meetings/' + m.meetingId + '/cancel').catch(() => {}); await m.api.close().catch(() => {})
  })
})
