// 60 - Journey: guests waiting for the host, with real browsers (8 Nov).
//  A. The meeting is open (its time has come) but the host is not in: guests open the link and wait; the host's
//     dashboard shows "Starting now", "Nobody has joined yet" and "2 waiting for you"; when the host joins, the guests
//     are let in by themselves and the dashboard shows "Live · 3 people in the meeting" without the waiting tag.
//  B. Scheduled for later: guests open the link early and see the countdown; the dashboard shows the meeting under
//     "Coming up today" with "2 waiting for you"; the host starts early and the guests are let in.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const pass = () => jwt.sign({ email: HOST, displayName: H.HOST_DISPLAY || 'Host', isAdmin: true }, KEY, { expiresIn: '1h' })
const istIn = mins => new Date(Date.now() + mins * 60000 + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ':00'

async function guestWaits (roomUuid, name) {                         // a real guest on the join page, until the waiting screen
  const browser = await H.launch(); const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  const page = await ctx.newPage()
  await page.goto(`${BASE}/join/${roomUuid}`)
  await page.locator('#n').fill(name)
  await page.locator('#btn').click()
  await expect(page.locator('#waiting')).toBeVisible({ timeout: 20000 })
  return { browser, page, name }
}
async function hostDashboard (browser) {
  const ctx = await browser.newContext()
  await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  const page = await ctx.newPage()
  await page.goto(`${BASE}/dashboard#today`)
  await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
  return { ctx, page }
}

test.describe.serial('60 - Guests waiting for the host (journey)', () => {
  test.setTimeout(240000)
  let api
  const made = [], open = []
  test.beforeAll(async () => { api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } }) })
  test.afterAll(async () => {
    for (const x of open) await x.browser.close().catch(() => {})
    for (const id of made) { await api.post('/api/meetings/' + id + '/end').catch(() => {}); await api.delete('/api/meetings/' + id).catch(() => {}) }
    await api.dispose()
  })

  test('A: open meeting, host not in: guests wait, dashboard shows it, host joins and they come in', async ({ browser }) => {
    const title = 'T60 due ' + Date.now()
    const m = await (await api.post('/api/meetings', { data: { title } })).json(); made.push(m.id)   // open now, nobody in
    const g1 = await guestWaits(m.room_uuid, 'Guest Asha'); open.push(g1)
    const g2 = await guestWaits(m.room_uuid, 'Guest Ravi'); open.push(g2)
    await expect(g1.page.locator('#waiting')).toContainText(/host/i)

    const d = await hostDashboard(browser)
    const row = d.page.locator('.row.due', { hasText: title })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row).toContainText('Nobody has joined yet')
    await expect(row.locator('.chip.wait')).toHaveText('2 waiting for you', { timeout: 15000 })
    await expect(row.locator('.chip.wait')).toHaveAttribute('title', /Guest Asha/)

    const host = await H.joinAsHost(m.id); open.push(host)                 // the host joins
    for (const g of [g1, g2]) await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 30000 })   // let in by themselves
    const live = d.page.locator('.live', { hasText: title })
    await expect(live).toContainText('3 people in the meeting', { timeout: 40000 })
    await expect(live.locator('.chip.wait')).toHaveCount(0)
    await expect(d.page.locator('.row.due', { hasText: title })).toHaveCount(0)
    await d.ctx.close()
  })

  test('B: scheduled for later: guests wait early, dashboard shows it, host starts early and they come in', async ({ browser }) => {
    const title = 'T60 later ' + Date.now()
    const r = await api.post('/api/meetings', { data: { title, scheduled_at: istIn(20), timezone: 'Asia/Kolkata', duration_minutes: 30 } })
    const m = await r.json(); made.push(m.id); expect(m.status).toBe('scheduled')
    const g1 = await guestWaits(m.room_uuid, 'Guest Meera'); open.push(g1)
    const g2 = await guestWaits(m.room_uuid, 'Guest Kiran'); open.push(g2)
    await expect(g1.page.locator('#meet-countdown')).toBeVisible()

    const d = await hostDashboard(browser)
    const row = d.page.locator('.row', { hasText: title })
    await expect(row).toBeVisible({ timeout: 15000 })
    await expect(row.locator('.chip.wait')).toHaveText('2 waiting for you', { timeout: 15000 })

    expect((await api.post('/api/meetings/' + m.id + '/start')).ok()).toBe(true)   // Start early
    const host = await H.joinAsHost(m.id); open.push(host)
    for (const g of [g1, g2]) await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 30000 })
    await expect(d.page.locator('.live', { hasText: title })).toContainText('3 people in the meeting', { timeout: 40000 })
    await d.ctx.close()
  })
})
