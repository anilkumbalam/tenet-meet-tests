// 65 - A busy week seen by everyone (9 Nov). One host plans seven meetings with different people; then the dashboard is
// opened as each person: the host, an invited colleague, the planned co-host, a colleague who is not invited, and an
// admin. Each must see exactly their meetings, under the right tab and section, in time order, with the right line
// ("You and N invited" / "Host: ..."), chips, buttons and tab counts; plus a guest's view of their link and a phone.
// All addresses are test addresses (pwx-..., example.com, .invalid): mail.js sends them nothing (9 Nov).
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const RUN = Date.now().toString(36)
const DOM = '@tenetnetworks.com'
const P = {
  host:  { email: 'pwx-host65-' + RUN + DOM,  name: 'PWX Host' },
  priya: { email: 'pwx-priya65-' + RUN + DOM, name: 'PWX Priya' },
  ravi:  { email: 'pwx-ravi65-' + RUN + DOM,  name: 'PWX Ravi' },
  other: { email: 'pwx-other65-' + RUN + DOM, name: 'PWX Other' },
  admin: { email: process.env.HOST_EMAIL || 'anil@tenetnetworks.com', name: H.HOST_DISPLAY || 'Admin', isAdmin: true },
}
const GUESTS = ['guest1-' + RUN + '@example.com', 'guest2-' + RUN + '@example.com', 'raj-' + RUN + '@acme.invalid']
const pass = p => jwt.sign({ email: p.email, displayName: p.name, isAdmin: Boolean(p.isAdmin) }, KEY, { expiresIn: '1h' })
const IST = 'Asia/Kolkata'
const wall = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: IST, hour12: false }).slice(0, 16) + ':00'
const istDay = ms => new Date(ms).toLocaleDateString('sv-SE', { timeZone: IST })
const at = (days, hh, mm) => { const d = new Date(Date.now() + days * 86400000).toLocaleDateString('sv-SE', { timeZone: IST }); return new Date(d + 'T' + String(hh).padStart(2, '0') + ':' + String(mm).padStart(2, '0') + ':00+05:30').getTime() }
const minute = ms => Math.floor(ms / 60000) * 60000

// The plan. invited: people on the invite; cohost: planned co-host; who: which test people should see it (besides the host)
const now = Date.now()
const soon = minute(now + 90 * 60000)                       // later today (or just after midnight, worked out below)
const PLAN = [
  { key: 'now',     title: 'T65 standup ' + RUN,       open: true, invited: [P.priya.email] },
  { key: 'soon',    title: 'T65 client call ' + RUN,   at: soon, invited: [P.priya.email, GUESTS[0]] },
  { key: 'tomorrow', title: 'T65 design review ' + RUN, at: at(1, 10, 0), invited: [P.priya.email, P.ravi.email, ...GUESTS], cohost: P.ravi.email, waiting: true },
  { key: 'weekly',  title: 'T65 weekly sync ' + RUN,   at: at(3, 11, 30), invited: [P.priya.email], weekly: true },
  { key: 'nextweek', title: 'T65 vendor visit ' + RUN, at: at(8, 15, 0), invited: [P.ravi.email] },
  { key: 'ended',   title: 'T65 kickoff ' + RUN,       open: true, end: true, invited: [P.priya.email, GUESTS[0]] },
  { key: 'cancelled', title: 'T65 cancelled ' + RUN,   at: at(2, 9, 0), cancel: true, invited: [P.priya.email] },
]
const sees = (who, m) => who === 'host' || (m.invited || []).includes(P[who] && P[who].email) || m.cohost === (P[who] && P[who].email)

async function dash (browser, who, device = H.DESKTOP) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST, ...device })
  await ctx.addCookies([{ name: 'meet_token', value: pass(P[who]), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  await page.goto(BASE + '/dashboard?dash=4#today')
  await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
  return { ctx, page }
}
// Every visible meeting row of this run on the current tab: title, section heading, text, and whether it has a ⋯ button
const rows = page => page.evaluate(run => [...document.querySelectorAll('.row, .live')].filter(r => r.offsetParent !== null && r.textContent.includes(run)).map(r => {
  let sec = ''; for (let e = (r.closest('.rows') || r).previousElementSibling; e; e = e.previousElementSibling) if (e.classList.contains('sec')) { sec = e.textContent.trim(); break }
  const t = (r.querySelector('.meeting-title') || {}).textContent || ''
  return { title: t.replace(/ — .*$/, ''), sec, text: r.innerText.replace(/\s+/g, ' '), more: Boolean(r.querySelector('button.more')) }
}), RUN)
async function tab (page, name) { await page.evaluate(t => window.showTab(t), name); await page.waitForTimeout(700); return rows(page) }
const count = async (page, id) => Number(((await page.locator('#' + id).textContent()) || '').replace(/\D+/g, '') || 0)

test.describe.serial('65 - A busy week seen by everyone', () => {
  test.setTimeout(240000)
  let api, admin
  const M = {}, ctxs = []
  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, extraHTTPHeaders: { cookie: 'meet_token=' + pass(P.host) } })
    admin = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, extraHTTPHeaders: { cookie: 'meet_token=' + pass(P.admin) } })
    for (const m of PLAN) {
      const body = { title: m.title, duration_minutes: 45, invited_emails: (m.invited || []).join(',') }
      if (m.at) Object.assign(body, { scheduled_at: wall(m.at), timezone: IST })
      if (m.cohost) body.planned_cohosts = m.cohost
      if (m.waiting) body.waiting_room = 1
      if (m.weekly) Object.assign(body, { recurrence: 'weekly', recurrence_days: String(new Date(wall(m.at).replace(' ', 'T') + '+05:30').getDay()), recurrence_end_date: '' })
      const r = await api.post('/api/meetings', { data: body })
      expect(r.ok(), 'create ' + m.key + ' (' + r.status() + ')').toBe(true)
      M[m.key] = Object.assign({}, m, await r.json())
      if (m.waiting) expect((await api.patch('/api/meetings/' + M[m.key].id, { data: { waiting_room: 1 } })).ok(), 'waiting room on').toBe(true)
      if (m.end) expect((await api.post('/api/meetings/' + M[m.key].id + '/end')).ok(), 'end ' + m.key).toBe(true)
      if (m.cancel) expect((await api.post('/api/meetings/' + M[m.key].id + '/cancel')).ok(), 'cancel ' + m.key).toBe(true)
    }
  })
  test.afterAll(async () => {
    for (const c of ctxs) await c.close().catch(() => {})
    for (const m of Object.values(M)) { await admin.post('/api/meetings/' + m.id + '/end').catch(() => {}); await admin.delete('/api/meetings/' + m.id).catch(() => {}) }
    await api.dispose(); await admin.dispose()
  })

  // What a person should see on the Today tab, and under which heading
  const todaySection = m => m.open && !m.end ? /^Starting now/ : istDay(m.at) === istDay(Date.now()) ? /^Coming up today/ : /^Later this week/
  const onToday = m => !m.cancel && !m.end && (m.open || m.at - Date.now() < 7 * 86400000)
  const upcoming = m => !m.cancel && !m.open && m.at > Date.now()

  for (const who of ['host', 'priya', 'ravi']) {
    test(who + ': Today, Upcoming and Past show exactly their meetings, in order, with the right lines and buttons', async ({ browser }) => {
      const d = await dash(browser, who); ctxs.push(d.ctx)
      const mine = PLAN.filter(m => sees(who, m))
      // Today
      const today = await tab(d.page, 'today')
      const wantToday = mine.filter(onToday)
      expect(today.map(r => r.title).sort(), who + ' Today: exactly these').toEqual(wantToday.map(m => m.title).sort())
      for (const m of wantToday) expect(today.find(r => r.title === m.title).sec, m.key + ' section').toMatch(todaySection(m))
      // Upcoming: by time, under the right day
      const up = await tab(d.page, 'upcoming')
      const wantUp = mine.filter(upcoming).sort((a, b) => a.at - b.at)
      expect(up.map(r => r.title), who + ' Upcoming: exactly these, earliest first').toEqual(wantUp.map(m => m.title))
      for (const m of wantUp) {
        const r = up.find(x => x.title === m.title)
        const day = istDay(m.at) === istDay(Date.now()) ? 'Today' : new Date(m.at).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: IST })
        expect(r.sec, m.key + ' day heading').toBe(day)
        expect(r.text, m.key + ' time').toContain(new Date(m.at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: IST }))
        if (who === 'host') expect(r.text, m.key + ' host line').toContain(m.invited.length ? 'You and ' + m.invited.length + ' invited' : 'Only you so far')
        else expect(r.text, m.key + ' host named').toContain('Host: ' + P.host.email)
        expect(r.more, m.key + ' ⋯ only for the host').toBe(who === 'host')
        if (m.waiting) expect(r.text, 'waiting room chip').toContain('Waiting room')
        if (m.cohost) expect(r.text, 'co-host chip').toContain('Co-host: Pwx')
        if (m.weekly) expect(r.text, 'repeat badge').toMatch(/Weekly · (Mon|Tue|Wed|Thu|Fri|Sat|Sun)/)
        if (who !== 'host' && m.at - Date.now() > 16 * 60000) expect(r.text, 'invitee sees when Join opens').toMatch(/Join opens \d\d:\d\d/)
      }
      expect(await count(d.page, 'tab-upcoming'), who + ' Upcoming count on the tab').toBe(up.length)   // test people have no other meetings
      // Past: the ended meeting, and the cancelled one marked as cancelled (9 Nov: it showed as held, with a negative duration)
      const past = await tab(d.page, 'ended')
      expect(past.map(r => r.title).sort(), who + ' Past').toEqual(mine.filter(m => m.end || m.cancel).map(m => m.title).sort())
      for (const r of past) expect(r.more, 'no ⋯ on Past').toBe(false)
      for (const m of mine.filter(x => x.cancel)) { const r = past.find(x => x.title === m.title); expect(r.text, 'cancelled row').toMatch(/Cancelled .*Cancelled on \d{1,2} [A-Z][a-z]{2}/); expect(r.text, 'no people or minutes on a cancelled row').not.toMatch(/people|min /) }
      for (const m of mine.filter(x => x.end)) expect(past.find(x => x.title === m.title).text, 'held meeting is not marked cancelled').not.toContain('Cancelled')
    })
  }

  test('a colleague who is not invited sees none of these meetings', async ({ browser }) => {
    const d = await dash(browser, 'other'); ctxs.push(d.ctx)
    for (const t of ['today', 'upcoming', 'ended']) expect(await tab(d.page, t), 'other: ' + t).toEqual([])
  })

  test('admin: none on their own tabs; all of them under All meetings, with ⋯ on the scheduled ones', async ({ browser }) => {
    const d = await dash(browser, 'admin'); ctxs.push(d.ctx)
    for (const t of ['today', 'upcoming', 'ended']) expect(await tab(d.page, t), 'admin own ' + t).toEqual([])
    const all = await tab(d.page, 'all')
    const want = PLAN
    expect(all.map(r => r.title).sort(), 'All meetings').toEqual(want.map(m => m.title).sort())
    for (const m of want.filter(x => x.at && !x.cancel)) expect(all.find(r => r.title === m.title).more, m.key + ': admin ⋯').toBe(true)
  })

  test('a guest opening the design review link sees the title, the host and the countdown', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST }); ctxs.push(ctx)
    const page = await ctx.newPage()
    await page.goto(BASE + '/join/' + M.tomorrow.room_uuid)
    await page.locator('#n').fill('Guest One')
    await page.locator('#btn').click()
    await expect(page.locator('#waiting')).toBeVisible({ timeout: 20000 })
    await expect(page.locator('#meet-title')).toHaveText(M.tomorrow.title)
    await expect(page.locator('#meet-host')).toContainText('Host:')
    await expect(page.locator('#meet-countdown')).toHaveText(/^Starts in (\d+ h( \d+ min)?|1 day( \d+ h)?)$/)
  })

  test('phone: the invited colleague\'s Upcoming fits the screen', async ({ browser }) => {
    const d = await dash(browser, 'priya', H.PHONE); ctxs.push(d.ctx)
    const up = await tab(d.page, 'upcoming')
    expect(up.length, 'rows shown').toBe(PLAN.filter(m => sees('priya', m) && upcoming(m)).length)
    expect(await d.page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 'no sideways scrolling').toBeLessThanOrEqual(1)
  })

  // Part 2: plans change after the invites went out; the dashboard must follow for everyone
  test('changes: moved, someone removed, someone added, waiting room off', async ({ browser }) => {
    const moved = at(2, 16, 0)
    expect((await api.patch('/api/meetings/' + M.tomorrow.id, { data: { scheduled_at: wall(moved), timezone: IST, waiting_room: 0 } })).ok(), 'move the design review, waiting room off').toBe(true)
    expect((await api.patch('/api/meetings/' + M.nextweek.id, { data: { invited_emails: '' } })).ok(), 'remove Ravi from the vendor visit').toBe(true)
    expect((await api.patch('/api/meetings/' + M.weekly.id, { data: { invited_emails: [P.priya.email, P.other.email].join(',') } })).ok(), 'add the other colleague to the weekly sync').toBe(true)
    const day = ms => new Date(ms).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', timeZone: IST })
    // Priya: the design review is under its new day, at 16:00
    const pr = await dash(browser, 'priya'); ctxs.push(pr.ctx)
    const pUp = await tab(pr.page, 'upcoming')
    const dr = pUp.find(r => r.title === M.tomorrow.title)
    expect(dr && dr.sec, 'moved to its new day').toBe(day(moved))
    expect(dr.text, 'at its new time').toContain('16:00')
    // the host: no Waiting room chip any more
    const ho = await dash(browser, 'host'); ctxs.push(ho.ctx)
    const hUp = await tab(ho.page, 'upcoming')
    expect(hUp.find(r => r.title === M.tomorrow.title).text, 'waiting room chip gone').not.toContain('Waiting room')
    expect(hUp.find(r => r.title === M.nextweek.title).text, 'vendor visit: nobody invited now').toContain('Only you so far')
    // Ravi: no vendor visit any more (still the design review, as planned co-host)
    const ra = await dash(browser, 'ravi'); ctxs.push(ra.ctx)
    expect((await tab(ra.page, 'upcoming')).map(r => r.title), 'Ravi now').toEqual([M.tomorrow.title])
    // the other colleague: now sees the weekly sync
    const ot = await dash(browser, 'other'); ctxs.push(ot.ctx)
    expect((await tab(ot.page, 'upcoming')).map(r => r.title), 'the other colleague now').toEqual([M.weekly.title])
    // a guest on the design review link: the countdown follows the new time (about 2 days)
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST }); ctxs.push(ctx)
    const g = await ctx.newPage()
    await g.goto(BASE + '/join/' + M.tomorrow.room_uuid); await g.locator('#n').fill('Guest One'); await g.locator('#btn').click()
    await expect(g.locator('#waiting')).toBeVisible({ timeout: 20000 })
    await expect(g.locator('#meet-countdown')).toHaveText(/^Starts in (1 day|2 days)( \d+ h)?$/)
  })
})
