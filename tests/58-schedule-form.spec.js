// 58 - Dashboard v4 schedule form (8 Nov): what, when, who, agenda; rarely changed settings under "More options".
//  - Buttons always visible; "More options" folded with a one-line summary.
//  - The co-host picker shows only once a colleague who can be co-host is invited.
//  - Editing a meeting that uses one of the folded settings opens "More options" by itself.
//  - Creating a meeting through the form still works (same fields sent as before).
//  - Today tab: an open meeting with nobody in it is under "Starting now" (not a "Live" card).
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const DOMAIN = HOST.split('@')[1]
const pass = () => jwt.sign({ email: HOST, displayName: 'T58', isAdmin: true }, KEY, { expiresIn: '1h' })
async function dash (browser, opts) {
  const ctx = await browser.newContext(opts || {})
  await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  page.on('dialog', d => { throw new Error('browser dialog: ' + d.message()) })
  await page.goto(`${BASE}/dashboard?dash=4`)
  await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
  return { ctx, page }
}
const tomorrow = () => new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10)

test.describe.serial('58 - Schedule form', () => {
  test.setTimeout(90000)
  const made = []
  test.afterAll(async () => {
    const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } })
    for (const id of made) await api.delete('/api/meetings/' + id).catch(() => {})
    await api.dispose()
  })

  test('new meeting: More options folded with a summary, buttons visible, co-host only when a colleague is invited', async ({ browser }) => {
    const { ctx, page } = await dash(browser)
    await page.locator('#btnSchedule').click()
    await expect(page.locator('#schedModal')).toHaveClass(/open/)
    await expect(page.locator('#mMore')).not.toHaveAttribute('open', '')
    await expect(page.locator('#mMoreSum')).toContainText('Repeat (daily, weekly, monthly)')
    await expect(page.locator('#mMoreSum')).not.toContainText('Set:')                 // nothing changed yet
    await expect(page.locator('#schedBtn')).toBeInViewport()
    await expect(page.locator('#mPlannedBox')).toBeHidden()
    await page.locator('#mInvited').fill('guest58@example.com')
    await expect(page.locator('#mPlannedBox')).toBeHidden()                         // a guest can't be co-host
    await page.locator('#mInvited').fill('guest58@example.com, pw58@' + DOMAIN)
    await expect(page.locator('#mPlannedBox')).toBeVisible()
    await page.locator('#mMore > summary').click()
    await expect(page.locator('#mRecur')).toBeVisible()
    await expect(page.locator('#mAutoCohost')).toBeAttached()
    await expect(page.locator('#mWaitingRoom')).toBeAttached()
    await ctx.close()
  })

  test('create through the form; editing it opens More options when a folded setting is used', async ({ browser }) => {
    const { ctx, page } = await dash(browser)
    const title = 'T58 form ' + Date.now()
    await page.locator('#btnSchedule').click()
    await page.locator('#mTitle').fill(title)
    await page.locator('#mDate').fill(tomorrow())
    await page.locator('#mTimeOnly').fill('11:00')
    await page.locator('#mMore > summary').click()
    await page.locator('#mWaitingRoom').check()
    const created = page.waitForResponse(r => r.url().endsWith('/api/meetings') && r.request().method() === 'POST')
    await page.locator('#schedBtn').click()
    const m = await (await created).json(); made.push(m.id)
    expect(m.waiting_room).toBe(1)
    await expect(page.locator('#schedModal')).not.toHaveClass(/open/)
    await page.evaluate(id => editMeeting(id), m.id)
    await expect(page.locator('#mMore')).toHaveAttribute('open', '')               // waiting room is on: opened by itself
    await expect(page.locator('#mWaitingRoom')).toBeChecked()
    await page.locator('#mMore > summary').click()                                   // fold it: the changed setting stays visible
    await expect(page.locator('#mMoreSum')).toContainText('Set: Waiting room on')
    await ctx.close()
  })

  test('an open meeting with nobody in it is under "Starting now", not shown as live', async ({ browser }) => {
    const api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } })
    const title = 'T58 open ' + Date.now()
    const r = await api.post('/api/meetings', { data: { title } })                        // started now, nobody joins
    const m = await r.json(); made.push(m.id); await api.dispose()
    const { ctx, page } = await dash(browser)
    const row = page.locator('.row.due', { hasText: title })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText('Nobody has joined yet')
    await expect(row.locator('button', { hasText: 'Start' })).toBeVisible()
    await expect(page.locator('.live', { hasText: title })).toHaveCount(0)
    await ctx.close()
  })

  test('phone: the form fills the screen and the buttons stay visible', async ({ browser }) => {
    const { ctx, page } = await dash(browser, { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
    await page.locator('#btnSchedule').click()
    await expect(page.locator('#schedBtn')).toBeInViewport()
    const sw = await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)
    expect(sw).toBe(true)
    await ctx.close()
  })
})
