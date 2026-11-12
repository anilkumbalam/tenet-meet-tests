// 66 - Dashboard hiccups (9 Nov). The meeting list (refreshed every 5 s) answers slowly, then with a server error, then
// not at all (network gone), then normally again. Through all of it the dashboard keeps showing the last good list (never
// blank, never "undefined"), does not sign the person out, and picks up a new meeting by itself once things recover.
// The 500s and aborted requests are made by this test, so the guard is told to expect them.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const RUN = Date.now().toString(36)
const HOST = { email: 'pwx-host66-' + RUN + '@tenetnetworks.com', name: 'PWX Host' }
const pass = () => jwt.sign({ email: HOST.email, displayName: HOST.name, isAdmin: false }, KEY, { expiresIn: '1h' })
const IST = 'Asia/Kolkata'
const wall = ms => new Date(ms).toLocaleString('sv-SE', { timeZone: IST, hour12: false }).slice(0, 16) + ':00'
const LIST = /\/api\/meetings\?with=invited/

test.describe.serial('66 - Dashboard hiccups', () => {
  test.setTimeout(180000)
  let api, page, ctx
  const made = []
  const mk = async title => { const r = await api.post('/api/meetings', { data: { title, scheduled_at: wall(Date.now() + 26 * 3600000), timezone: IST, duration_minutes: 30 } }); expect(r.ok()).toBe(true); const m = await r.json(); made.push(m.id); return m }
  const titles = () => page.evaluate(run => [...document.querySelectorAll('.meeting-title')].filter(e => e.offsetParent !== null && e.textContent.includes(run)).map(e => e.textContent), RUN)
  const healthy = async (label) => {
    expect((await titles()).length, label + ': the list is still shown').toBeGreaterThan(0)
    const body = await page.evaluate(() => document.body.innerText)
    expect(body, label + ': no slips on screen').not.toMatch(/\bundefined\b|\bNaN\b|\[object /)
    await expect(page.locator('#sg-out'), label + ': not signed out').toBeHidden()
    expect(await page.evaluate(() => document.readyState), label + ': page alive').toBe('complete')
  }
  test.beforeAll(async ({ browser }) => {
    api = await request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } })
    await mk('T66 first ' + RUN); await mk('T66 second ' + RUN)
    ctx = await browser.newContext({ ignoreHTTPSErrors: true, timezoneId: IST })
    await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
    page = await ctx.newPage()
    await page.goto(BASE + '/dashboard#upcoming')
    await expect.poll(() => titles().then(t => t.length), { timeout: 15000 }).toBe(2)
  })
  test.afterAll(async () => {
    await ctx.close().catch(() => {})
    for (const id of made) await api.delete('/api/meetings/' + id).catch(() => {})
    await api.dispose()
  })
  test.beforeEach(() => { test.info().annotations.push({ type: 'guard-allow', description: '/api/meetings\\?with=invited|ERR_INTERNET_DISCONNECTED|ERR_FAILED|Failed to fetch' }) })

  test('slow answers (8 s): the list stays, nothing breaks', async () => {
    await page.route(LIST, async r => { await new Promise(s => setTimeout(s, 8000)); await r.continue().catch(() => {}) })
    await page.waitForTimeout(12000)
    await healthy('slow')
    await page.unroute(LIST)
  })

  test('server errors (500): the list stays, no sign-out', async () => {
    await page.route(LIST, r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Server error"}' }))
    await page.waitForTimeout(12000)
    await healthy('500')
    await page.unroute(LIST)
  })

  test('network gone: the list stays', async () => {
    await page.route(LIST, r => r.abort('internetdisconnected'))
    await page.waitForTimeout(12000)
    await healthy('offline')
    await page.unroute(LIST)
  })

  test('everything back: a meeting made meanwhile appears by itself within 10 s', async () => {
    await mk('T66 third ' + RUN)
    await expect.poll(() => titles().then(t => t.length), { message: 'the new meeting shows without a reload', timeout: 12000 }).toBe(3)
    await healthy('back')
  })
})
