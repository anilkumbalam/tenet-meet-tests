// 52 - Dashboard and sign-in lifetime (7 Nov, item 7 / stage D2: signin-guard.js, start-note.js, server redirect).
//  - The 5-second refresh of the meeting list is marked as background (it must not keep a sign-in alive).
//  - When the sign-in ends while the dashboard is open, it says so with a Sign in button.
//  - Start now while hosting a meeting that is on asks first (Cancel / Go to current meeting / Start another).
//  - A page opened with an ended sign-in goes to the sign-in page, which says why.
const { test, expect, request } = require('@playwright/test')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const MIN = 60 * 1000

const pass = (times, email = HOST) => jwt.sign(Object.assign({ email, displayName: 'Anil Kumbalam', isAdmin: false }, times), KEY, { expiresIn: '2h' })
async function dashboard (browser, tok) {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: 'meet_token', value: tok, domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  return { ctx, page }
}

test.describe.serial('52 - Dashboard and sign-in lifetime', () => {
  test.setTimeout(120000)

  test('the meeting list refresh is sent as background', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser, pass({}))
    const seen = []
    page.on('request', r => { if (/\/api\/meetings\/?$/.test(new URL(r.url()).pathname) && r.method() === 'GET') seen.push(r.headers()['x-tenet-background'] || '') })
    await page.goto(`${BASE}/dashboard`)
    await expect.poll(() => seen.length, { timeout: 15000 }).toBeGreaterThanOrEqual(2)
    expect(seen.every(h => h === '1'), 'every refresh marked: ' + JSON.stringify(seen)).toBe(true)
    await ctx.close()
  })

  test('the sign-in ends while the dashboard is open: "Your sign-in has expired" with Sign in', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser, pass({}))
    await page.goto(`${BASE}/dashboard`)
    await expect(page.locator('#startNowBtn, .tab-btn').first()).toBeAttached({ timeout: 15000 })
    await ctx.addCookies([{ name: 'meet_token', value: pass({ sat: Date.now() - 120 * MIN, act: Date.now() - 61 * MIN }), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
    await expect(page.locator('#sg-signin')).toBeVisible({ timeout: 15000 })                    // the next 5 s refresh notices
    await expect(page.locator('.sg-card')).toContainText('Your sign-in has expired')
    await expect(page.locator('.sg-card')).toContainText('after an hour without use')
    await ctx.close()
  })

  test('signed out in another window: "You\u2019re signed out"; Not now leaves the thin bar with Sign in', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser, pass({}))
    await page.goto(`${BASE}/dashboard`)
    await expect(page.locator('.tab-btn').first()).toBeAttached({ timeout: 15000 })
    await ctx.clearCookies()                                                                    // as a sign-out in another window does
    await expect(page.locator('#sg-signin')).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.sg-card')).toContainText('signed out')
    await page.locator('#sg-later').click()
    await expect(page.locator('.sg-card')).toHaveCount(0)
    await expect(page.locator('#sg-bar')).toBeVisible()
    await expect(page.locator('#sg-bar-signin')).toBeVisible()
    await page.getByRole('button', { name: /Start Now/i }).first().click()                   // an action while signed out: the box comes back
    await expect(page.locator('.sg-card')).toContainText('signed out')
    await expect(page.locator('#startNowModal')).not.toHaveClass(/open/)
    await ctx.close()
  })

  test('Start now while hosting a meeting that is on: asked first; Cancel, then Start another', async ({ browser }) => {
    const m = await H.createMeeting(browser, 'hosting-check')
    await m.api.request.post(`${BASE}/api/meetings/${m.meetingId}/start`)
    const { ctx, page } = await dashboard(browser, pass({}))
    await page.addInitScript(() => { window.__tenetHostingCheck = true })
    try {
      await page.goto(`${BASE}/dashboard`)
      await expect.poll(() => page.evaluate(() => typeof allMeetings !== 'undefined' && allMeetings.some(x => x.status === 'active')), { timeout: 15000 }).toBe(true)
      await page.evaluate(() => startNow())
      await expect(page.locator('.sg-card')).toContainText('right now')
      await expect(page.locator('#sg-current')).toBeVisible()
      await page.locator('#sg-cancel').click()
      await expect(page.locator('.sg-card')).toHaveCount(0)
      await expect(page.locator('#startNowModal')).not.toHaveClass(/open/)
      await page.evaluate(() => startNow())
      await page.locator('#sg-another').click()
      await expect(page.locator('#startNowModal')).toHaveClass(/open/)                          // the usual Start now form
    } finally {
      await m.api.request.post(`${BASE}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
      await m.api.close().catch(() => {}); await ctx.close()
    }
  })

  test('opening the dashboard with an ended sign-in: sign-in page says why', async ({ browser }) => {
    const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass({ sat: Date.now() - 120 * MIN, act: Date.now() - 61 * MIN }, `t52-${Date.now()}@tenetnetworks.com`), Accept: 'text/html' } })
    const r = await api.get('/dashboard', { maxRedirects: 0 })
    expect(r.headers().location || '').toMatch(/\/start\?ended=idle/)
    await api.dispose()
    const ctx = await browser.newContext(); const page = await ctx.newPage()
    await page.goto(`${BASE}/start?ended=idle`)
    await expect(page.locator('#errMsg')).toContainText('after an hour without use')
    await page.goto(`${BASE}/start?ended=disabled`)
    await expect(page.locator('#errMsg')).toContainText('disabled')
    await ctx.close()
  })
})
