// 64 - Clock and time zones (9 Nov). The page's clock is moved forward where only the page decides (countdown,
// "Starting now" for 2 hours); time zones are checked by giving the browser another zone and by meetings planned in
// another zone. The server always runs on the real clock.
//  A. Guest countdown: "Starts in 19m …s", and "Starting soon…" once the time has come.
//  B. A meeting planned in London time: the guest page says GMT with the matching IST time, and the countdown agrees
//     (so the server stored the right moment).
//  C. A guest whose computer is in New York: their own time first, the host's (IST) below it; same countdown.
//  D. Dashboard: an open meeting with nobody in it is under "Starting now" and moves to "Left open" after 2 hours.
//  E. Dashboard near midnight (viewer in India): a meeting at 00:10 tomorrow is not under Today but under tomorrow.
//  F. Dashboard viewer in London: their own time first with the meeting's IST time in brackets, on Upcoming and Past.
// Wording from time-label.js (9 Nov): "Starts in 3 days 4 h", "5 h 12 min", "19 min", "1 min 30 s".
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const pass = () => jwt.sign({ email: HOST, displayName: H.HOST_DISPLAY || 'Host', isAdmin: true }, KEY, { expiresIn: '1h' })
const RUN = Date.now().toString(36)

// 'YYYY-MM-DD HH:MM:00' for a moment, as a clock in that zone shows it
const wallTime = (ms, tz) => new Date(ms).toLocaleString('sv-SE', { timeZone: tz, hour12: false }).slice(0, 16) + ':00'
const istHHMM = ms => new Date(ms).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })
const minute = ms => Math.floor(ms / 60000) * 60000                       // planned times are kept to the minute
const norm = t => String(t || '').replace(/[\s\u202f\u00a0]+/g, ' ').trim().toLowerCase()

async function guestPage (browser, roomUuid, name, opts = {}) {
  const { clock, ...o } = opts
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: 'Asia/Kolkata', ...o })   // a guest in India unless said otherwise
  const page = await ctx.newPage()
  if (clock) await page.clock.install({ time: new Date() })
  await page.goto(BASE + '/join/' + roomUuid)
  await page.locator('#n').fill(name)
  await page.locator('#btn').click()
  await expect(page.locator('#waiting'), name + ' waits').toBeVisible({ timeout: 20000 })
  return { ctx, page }
}
async function dashboard (browser, tz, withClock) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: tz })
  await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  if (withClock) await page.clock.install({ time: new Date() })
  await page.goto(BASE + '/dashboard#today')
  await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
  return { ctx, page }
}
// The section heading a meeting row is listed under (rows follow their .sec heading)
const sectionOf = (page, title) => page.evaluate(t => {
  const row = [...document.querySelectorAll('.row, .live')].find(r => r.offsetParent !== null && r.textContent.includes(t))
  if (!row) return null
  for (let e = (row.closest('.rows') || row).previousElementSibling; e; e = e.previousElementSibling) if (e.classList.contains('sec')) return e.textContent.trim()   // rows sit in a .rows box after their heading
  return '(no heading)'
}, title)

test.describe.serial('64 - Clock and time zones', () => {
  test.setTimeout(180000)
  let api
  const made = [], ctxs = []
  const mk = async (title, extra) => { const r = await api.post('/api/meetings', { data: Object.assign({ title, duration_minutes: 30 }, extra) }); expect(r.ok(), 'create ' + title + ' (' + r.status() + ')').toBe(true); const m = await r.json(); made.push(m.id); return m }
  const full = (ms, tz) => new Date(ms).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short', timeZone: tz })   // the page's own format
  const time = (ms, tz) => new Date(ms).toLocaleTimeString('en-IN', { hour: 'numeric', minute: '2-digit', timeZone: tz })
  const hm = (ms, tz) => new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: tz })
  const hostLine = p => p.locator('#meet-time-host')
  test.beforeAll(async () => { api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } }) })
  test.afterAll(async () => {
    for (const c of ctxs) await c.close().catch(() => {})
    for (const id of made) { await api.post('/api/meetings/' + id + '/end').catch(() => {}); await api.delete('/api/meetings/' + id).catch(() => {}) }
    await api.dispose()
  })

  test('A: guest in India: "Starts in 19 min", then minutes and seconds near the end, then "Starting soon…"', async ({ browser }) => {
    const at = minute(Date.now() + 20 * 60000)
    const m = await mk('T64 countdown ' + RUN, { scheduled_at: wallTime(at, 'Asia/Kolkata'), timezone: 'Asia/Kolkata' })
    const g = await guestPage(browser, m.room_uuid, 'Guest Clock', { clock: true }); ctxs.push(g.ctx)
    await expect(g.page.locator('#meet-countdown')).toHaveText(/^Starts in (19|20) min$/, { timeout: 10000 })
    expect(norm(await g.page.locator('#meet-time').textContent()), 'own zone: one line').toBe(norm('Scheduled: ' + full(at, 'Asia/Kolkata') + ' IST'))
    await expect(hostLine(g.page), 'no host line in the same zone').toBeHidden()
    await g.page.clock.fastForward(Math.max(0, at - Date.now() - 90000))      // 1 min 30 s before
    await expect(g.page.locator('#meet-countdown')).toHaveText(/^Starts in (1 min )?\d{1,2} s$/, { timeout: 10000 })
    await g.page.clock.fastForward('03:00')
    await expect(g.page.locator('#meet-countdown')).toHaveText('Starting soon…', { timeout: 10000 })
  })

  test('A2: a meeting days away says days and hours', async ({ browser }) => {
    const at = minute(Date.now() + (3 * 24 + 5) * 3600000)
    const m = await mk('T64 days ' + RUN, { scheduled_at: wallTime(at, 'Asia/Kolkata'), timezone: 'Asia/Kolkata' })
    const g = await guestPage(browser, m.room_uuid, 'Guest Days'); ctxs.push(g.ctx)
    await expect(g.page.locator('#meet-countdown')).toHaveText(/^Starts in 3 days (4|5) h$/, { timeout: 10000 })
  })

  test('B: a meeting planned in London time, guest in India: their IST time first, the London time for the host', async ({ browser }) => {
    const at = minute(Date.now() + 30 * 60000)
    const m = await mk('T64 london ' + RUN, { scheduled_at: wallTime(at, 'Europe/London'), timezone: 'Europe/London' })
    const g = await guestPage(browser, m.room_uuid, 'Guest India'); ctxs.push(g.ctx)
    await expect(g.page.locator('#meet-countdown'), 'the server stored the right moment').toHaveText(/^Starts in (29|30) min$/, { timeout: 10000 })
    expect(norm(await g.page.locator('#meet-time').textContent())).toBe(norm('Scheduled: ' + full(at, 'Asia/Kolkata') + ' (your time)'))
    const sameDay = wallTime(at, 'Asia/Kolkata').slice(0, 10) === wallTime(at, 'Europe/London').slice(0, 10)
    await expect(hostLine(g.page)).toBeVisible()
    expect(norm(await hostLine(g.page).textContent())).toBe(norm((sameDay ? time(at, 'Europe/London') : full(at, 'Europe/London')) + ' GMT for the host'))
  })

  test('C: a guest in New York: their own time first, the IST time for the host, the same countdown', async ({ browser }) => {
    const at = minute(Date.now() + 20 * 60000)
    const m = await mk('T64 newyork ' + RUN, { scheduled_at: wallTime(at, 'Asia/Kolkata'), timezone: 'Asia/Kolkata' })
    const g = await guestPage(browser, m.room_uuid, 'Guest New York', { timezoneId: 'America/New_York' }); ctxs.push(g.ctx)
    await expect(g.page.locator('#meet-countdown')).toHaveText(/^Starts in (19|20) min$/, { timeout: 10000 })
    expect(norm(await g.page.locator('#meet-time').textContent())).toBe(norm('Scheduled: ' + full(at, 'America/New_York') + ' (your time)'))
    const sameDay = wallTime(at, 'Asia/Kolkata').slice(0, 10) === wallTime(at, 'America/New_York').slice(0, 10)
    expect(norm(await hostLine(g.page).textContent())).toBe(norm((sameDay ? time(at, 'Asia/Kolkata') : full(at, 'Asia/Kolkata')) + ' IST for the host'))
  })

  test('D: dashboard: an empty open meeting is under "Starting now", and under "Left open" after 2 hours', async ({ browser }) => {
    const title = 'T64 open ' + RUN
    await mk(title, {})
    const d = await dashboard(browser, 'Asia/Kolkata', true); ctxs.push(d.ctx)
    await expect.poll(() => sectionOf(d.page, title), { timeout: 15000 }).toMatch(/^Starting now/)
    await d.page.clock.fastForward('02:01:00')
    await expect.poll(() => sectionOf(d.page, title), { message: 'after 2 hours', timeout: 20000 }).toMatch(/^Left open/)
  })

  test('E: near midnight: a meeting at 00:10 tomorrow (India) is not under Today, but under tomorrow', async ({ browser }) => {
    const todayIst = new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Kolkata' })
    const tomorrow = new Date(new Date(todayIst + 'T12:00:00Z').getTime() + 86400000).toISOString().slice(0, 10)
    const title = 'T64 midnight ' + RUN
    await mk(title, { scheduled_at: tomorrow + ' 00:10:00', timezone: 'Asia/Kolkata' })
    const d = await dashboard(browser, 'Asia/Kolkata'); ctxs.push(d.ctx)
    await d.page.evaluate(() => window.showTab('today'))
    await d.page.waitForTimeout(1500)
    expect(await sectionOf(d.page, title) || '', 'not under today\'s meetings (Later this week is fine)').not.toMatch(/^(Starting now|Live now|Coming up today)/)
    await d.page.evaluate(() => window.showTab('upcoming'))
    const label = new Date(tomorrow + 'T12:00:00Z').toLocaleDateString('en-GB', { weekday: 'long', timeZone: 'UTC' })
    await expect.poll(() => sectionOf(d.page, title), { timeout: 15000 }).toContain(label)
    await expect(d.page.locator('.row', { hasText: title })).toContainText('00:10')
    await expect(d.page.locator('.row', { hasText: title }), 'India viewer, India meeting: no brackets').not.toContainText('(')
  })

  test('F: dashboard viewer in London: own time first, the IST time in brackets, on Upcoming and on Past', async ({ browser }) => {
    const at = minute(Date.now() + 3 * 3600000)
    const title = 'T64 viewer ' + RUN
    const m = await mk(title, { scheduled_at: wallTime(at, 'Asia/Kolkata'), timezone: 'Asia/Kolkata' })
    const want = hm(at, 'Europe/London') + ' (' + hm(at, 'Asia/Kolkata') + ' IST)'
    const d = await dashboard(browser, 'Europe/London'); ctxs.push(d.ctx)
    const row = d.page.locator('.row:visible', { hasText: title })
    for (const tab of ['today', 'upcoming']) { await d.page.evaluate(t => window.showTab(t), tab); await d.page.waitForTimeout(800); if (await row.count()) break }
    await expect(row, 'listed on Today or Upcoming').toHaveCount(1, { timeout: 15000 })
    await expect(row).toContainText(want)
    expect((await api.post('/api/meetings/' + m.id + '/start')).ok(), 'start it').toBe(true)
    expect((await api.post('/api/meetings/' + m.id + '/end')).ok(), 'end it, so it is in Past').toBe(true)
    await d.page.evaluate(() => window.showTab('ended'))
    const past = d.page.locator('.row:visible', { hasText: title }).locator('.when span')
    await expect(past, 'Past: own time, then the IST time in brackets').toHaveText(/^\d\d:\d\d \(\d\d:\d\d IST\)$/, { timeout: 15000 })
    const [own, ist] = ((await past.textContent()).match(/\d\d:\d\d/g) || []).map(t => { const [h, mm] = t.split(':').map(Number); return h * 60 + mm })
    const gap = ((ist - own) + 1440) % 1440, londonOffset = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London', timeZoneName: 'short' }).includes('BST') ? 60 : 0
    expect(gap, 'the two times are the same moment').toBe(330 - londonOffset)
  })
})
