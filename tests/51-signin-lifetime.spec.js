// 51 - Sign-in lifetime (7 Nov, item 7 / stage D1: session.js on the Meet server).
// Passes are made here with the same key the other tests use, with "signed in" (sat) and "last active" (act) times
// set in the past, so nothing has to wait an hour or a week.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const MIN = 60 * 1000, now = () => Date.now()
let n = 0
const email = () => `t51-${Date.now()}-${++n}@tenetnetworks.com`      // a new person each time (renewal runs once per person per 30 s)

function pass (o) { const { exp, ...times } = o; return jwt.sign(Object.assign({ email: email(), displayName: 'Test 51', isAdmin: false }, times), KEY, { expiresIn: exp || '2h' }) }
async function call (tok, path = '/auth/me', headers = {}) {
  const ctx = await request.newContext({ baseURL: BASE, extraHTTPHeaders: Object.assign({ cookie: 'meet_token=' + tok }, headers) })
  const r = await ctx.get(path, { maxRedirects: 0 })
  const set = r.headersArray().filter(h => h.name.toLowerCase() === 'set-cookie').map(h => h.value)
  const tokCookie = set.find(c => /^meet_token=[^;]+/.test(c) && !/^meet_token=;/.test(c))
  const renewed = tokCookie ? jwt.decode(tokCookie.split(';')[0].slice('meet_token='.length)) : null
  const ended = (set.find(c => /^meet_ended=/.test(c)) || '').split(';')[0].replace('meet_ended=', '') || null
  const out = { status: r.status(), renewed, ended, location: r.headers().location || null }
  await ctx.dispose(); return out
}

test.describe('51 - Sign-in lifetime', () => {
  test.beforeAll(() => { if (!KEY) throw new Error('no signing key found for test passes (H.JWT_SECRET / env)') })

  test('a pass from before the change (no times in it) keeps working and is renewed with both times', async () => {
    const r = await call(pass({}))
    expect(r.status).toBe(200)
    expect(r.renewed && r.renewed.act, 'renewed with a last-active time').toBeGreaterThan(now() - MIN)
    expect(r.renewed.sat, 'signed-in time kept').toBeLessThan(now() + MIN)
  })

  test('in use (last active 10 min ago): works, renewed, signed-in time unchanged', async () => {
    const sat = now() - 90 * MIN
    const r = await call(pass({ sat, act: now() - 10 * MIN }))
    expect(r.status).toBe(200)
    expect(r.renewed && r.renewed.act).toBeGreaterThan(now() - MIN)
    expect(r.renewed.sat).toBe(sat)
  })

  test('a background refresh is checked but does not count as use (no renewal)', async () => {
    const r = await call(pass({ sat: now() - 90 * MIN, act: now() - 10 * MIN }), '/auth/me', { 'X-Tenet-Background': '1' })
    expect(r.status).toBe(200)
    expect(r.renewed, 'not renewed').toBeNull()
  })

  test('no use for 61 minutes: signed out ("idle")', async () => {
    const r = await call(pass({ sat: now() - 120 * MIN, act: now() - 61 * MIN }))
    expect(r.status).toBe(401)
    expect(r.ended).toBe('idle')
  })

  test('7 days after signing in: signed out ("expired"), even if in use', async () => {
    const r = await call(pass({ sat: now() - (7 * 1440 + 1) * MIN, act: now() - 1 * MIN, exp: '8d' }))
    expect(r.status).toBe(401)
    expect(r.ended).toBe('expired')
  })

  test('an idle pass opening the dashboard goes to the sign-in page', async () => {
    const r = await call(pass({ sat: now() - 120 * MIN, act: now() - 61 * MIN }), '/dashboard', { Accept: 'text/html' })
    expect([301, 302, 303, 307]).toContain(r.status)
    expect(r.location || '').toMatch(/\/start/)
  })

  test('a forged pass is refused', async () => {
    const r = await call(jwt.sign({ email: 'x@tenetnetworks.com', sat: now(), act: now() }, 'not-the-key'))
    expect(r.status).toBe(401)
  })

  test('a host still joins and stays in a meeting with a normal test pass', async ({ browser }) => {
    const m = await H.createMeeting(browser, 'signin-life')
    const host = await H.joinAsHost(m.meetingId)
    try {
      await expect.poll(() => H.roomState(host.page), { timeout: 30000 }).toBe('connected')
    } finally {
      await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
      await host.browser.close().catch(() => {}); await m.api.close().catch(() => {})
    }
  })
})
