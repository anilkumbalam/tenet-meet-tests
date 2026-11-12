// 55 - Dashboard v4 (7 Nov): dashboard-v4.html, the /dashboard?dash=4 switch, and ?with=invited on the meeting list.
//  - ?dash=4 serves the new dashboard and remembers it; ?dash=old goes back.
//  - The meeting list with ?with=invited: a member also gets meetings they are invited to, never someone else's;
//    without it nothing changes (the old dashboard and the other tests see the same list as before).
//  - A member sees an invited meeting with the host's name and no ⋯ menu; "All meetings" is for admins only.
//  - The admin's Today / Upcoming show only their own meetings; "All meetings" shows everyone's.
//  - Our own dialog, never the browser's; a success message only when the server confirms.
//  - Fits a phone.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'                  // an admin
const MEMBER = process.env.MEMBER_EMAIL || 'pw-member55@tenetnetworks.com'        // not an admin (no row needed)
const DOMAIN = new URL(BASE).hostname

// the page takes Admin from the pass (as a real sign-in does from the users table): HOST signs in as admin
const pass = (email, name) => jwt.sign({ email, displayName: name, isAdmin: email === HOST }, KEY, { expiresIn: '2h' })
const api = email => request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass(email, email.split('@')[0]) } })
async function dash (browser, email, opts = {}) {
  const ctx = await browser.newContext(opts)
  await ctx.addCookies([{ name: 'meet_token', value: pass(email, email.split('@')[0]), domain: DOMAIN, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  page.on('dialog', d => { throw new Error('browser dialog opened: ' + d.message()) })
  return { ctx, page }
}
const tomorrow = () => new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10) + ' 11:00:00'   // IST date
const STAMP = Date.now()
const T = { invited: 'T55 invited ' + STAMP, other: 'T55 other ' + STAMP, member: 'T55 member ' + STAMP, cancel: 'T55 cancel ' + STAMP }
const ids = {}

test.describe.serial('55 - Dashboard v4', () => {
  test.setTimeout(120000)

  test.beforeAll(async () => {
    const host = await api(HOST), mem = await api(MEMBER)
    const mk = async (ctx, title, extra) => {
      const r = await ctx.post('/api/meetings', { data: Object.assign({ title, scheduled_at: tomorrow(), timezone: 'Asia/Kolkata', duration_minutes: 30 }, extra) })
      expect(r.ok(), 'create ' + title + ': ' + r.status()).toBe(true)
      return (await r.json()).id
    }
    ids.invited = await mk(host, T.invited, { invited_emails: MEMBER })
    ids.other = await mk(host, T.other, {})
    ids.member = await mk(mem, T.member, {})
    ids.cancel = await mk(host, T.cancel, {})
    await host.dispose(); await mem.dispose()
  })

  test.afterAll(async () => {
    const host = await api(HOST)
    for (const id of Object.values(ids)) await host.delete('/api/meetings/' + id)                  // admin may delete any; delete sends no email
    await host.dispose()
  })

  test('?dash=4 serves the new dashboard and remembers it; ?dash=old goes back', async ({ browser }) => {
    const { ctx, page } = await dash(browser, HOST)
    await page.goto(`${BASE}/dashboard?dash=4`)
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.goto(`${BASE}/dashboard`)
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.goto(`${BASE}/dashboard?dash=old`)
    await expect(page.locator('.tab-btn').first()).toBeAttached({ timeout: 15000 })
    await expect(page.locator('#acctBtn')).toHaveCount(0)
    await page.goto(`${BASE}/dashboard`)
    await expect(page.locator('#acctBtn')).toHaveCount(0)
    await ctx.close()
  })

  test('meeting list: ?with=invited adds invited meetings for a member, never someone else’s', async () => {
    const mem = await api(MEMBER)
    const plain = await (await mem.get('/api/meetings')).json()
    const withInv = await (await mem.get('/api/meetings?with=invited')).json()
    const has = (list, id) => list.some(m => m.id === id)
    expect(has(plain, ids.member)).toBe(true)
    expect(has(plain, ids.invited), 'plain list unchanged: no invited meetings').toBe(false)
    expect(has(withInv, ids.member)).toBe(true)
    expect(has(withInv, ids.invited)).toBe(true)
    expect(has(withInv, ids.other), 'never someone else’s meeting').toBe(false)
    await mem.dispose()
  })

  test('member: invited meeting shows the host and no ⋯ menu; no "All meetings"', async ({ browser }) => {
    const { ctx, page } = await dash(browser, MEMBER)
    await page.goto(`${BASE}/dashboard#upcoming`)
    const row = page.locator('.row', { hasText: T.invited })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText('Host: ' + HOST)
    await expect(row.locator('.more')).toHaveCount(0)
    await expect(page.locator('.row', { hasText: T.other })).toHaveCount(0)
    await expect(page.locator('.row', { hasText: T.member }).locator('.more')).toHaveCount(1)
    await page.locator('#acctBtn').click()
    await expect(page.locator('#allTab')).toBeHidden()
    await expect(page.locator('#adminTab')).toBeHidden()
    await page.goto(`${BASE}/dashboard?r=1#all`)                                       // a real reload (a hash change alone would not)
    await expect(page.locator('#tab-today')).toHaveClass(/active/, { timeout: 15000 })
    await expect(page.locator('.all-head')).toHaveCount(0)
    await ctx.close()
  })

  test('admin: Upcoming shows only own meetings; "All meetings" shows everyone’s', async ({ browser }) => {
    const { ctx, page } = await dash(browser, HOST)
    await page.goto(`${BASE}/dashboard#upcoming`)
    await expect(page.locator('.row', { hasText: T.invited })).toBeVisible({ timeout: 15000 })
    await expect(page.locator('.row', { hasText: T.member })).toHaveCount(0)
    await page.locator('#acctBtn').click()
    await page.locator('#allTab').click()
    await expect(page.locator('.all-head')).toBeVisible()
    const row = page.locator('.row', { hasText: T.member })
    await expect(row).toBeVisible()
    await expect(row).toContainText('Host: ' + MEMBER)
    await row.locator('.more').click()
    await expect(page.locator('.menu button')).toHaveText(['Cancel meeting'])
    await page.keyboard.press('Escape')
    await ctx.close()
  })

  test('our own dialog; "Keep it" keeps the meeting; a refused cancel shows an error, not success', async ({ browser }) => {
    const { ctx, page } = await dash(browser, HOST)
    await page.goto(`${BASE}/dashboard#upcoming`)
    const row = page.locator('.row', { hasText: T.cancel })
    await expect(row).toBeVisible({ timeout: 15000 })
    await row.locator('.more').click()
    await page.locator('.menu button', { hasText: 'Cancel meeting' }).click()
    await expect(page.locator('.dlg')).toContainText('Cancel this meeting?')
    await page.locator('.dlg button', { hasText: 'Keep it' }).click()
    await expect(page.locator('.dlg')).toHaveCount(0)
    await expect(row).toBeVisible()
    await page.route('**/api/meetings/' + ids.cancel + '/cancel', r => r.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"Something went wrong"}' }))
    await row.locator('.more').click()
    await page.locator('.menu button', { hasText: 'Cancel meeting' }).click()
    await page.locator('.dlg button.btn-red').click()
    await expect(page.locator('#toast')).toContainText('Couldn’t cancel')
    await expect(page.locator('#toast')).not.toContainText('Meeting cancelled')
    await page.unroute('**/api/meetings/' + ids.cancel + '/cancel')
    await row.locator('.more').click()
    await page.locator('.menu button', { hasText: 'Cancel meeting' }).click()
    await page.locator('.dlg button.btn-red').click()
    await expect(page.locator('#toast')).toContainText('Meeting cancelled')
    await expect(row).toHaveCount(0, { timeout: 15000 })
    await ctx.close()
  })

  test('fits a phone: no sideways scrolling', async ({ browser }) => {
    const { ctx, page } = await dash(browser, HOST, { viewport: { width: 360, height: 740 }, isMobile: true, hasTouch: true })
    for (const tab of ['today', 'upcoming', 'ended']) {
      await page.goto(`${BASE}/dashboard?t=${tab}#${tab}`)
      await expect(page.locator('#tab-' + tab)).toHaveClass(/active/, { timeout: 15000 })
      await page.waitForTimeout(400)
      const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }))
      expect(m.sw, tab).toBeLessThanOrEqual(m.cw)
    }
    await ctx.close()
  })
})
