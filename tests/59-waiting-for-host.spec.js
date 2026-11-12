// 59 - Guests waiting for the host (8 Nov, waitcount.js): guests on the waiting screen of a meeting that has not
// started are counted (in memory, last 15 s) and shown to the host on the new dashboard ("N waiting for you").
//  - Only the host (or an admin) gets the count, and only on the new dashboard's list (?with=invited).
//  - Closing the waiting screen drops them off within 15 s.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const pass = () => jwt.sign({ email: HOST, displayName: 'T59', isAdmin: true }, KEY, { expiresIn: '1h' })
const tomorrow = () => new Date(Date.now() + 86400000 + 5.5 * 3600000).toISOString().slice(0, 10) + ' 11:00:00'

test.describe.serial('59 - Guests waiting for the host', () => {
  test.setTimeout(90000)
  let host, guest, m
  test.beforeAll(async () => {
    host = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } })
    guest = await request.newContext({ baseURL: BASE })
    const r = await host.post('/api/meetings', { data: { title: 'T59 waiting ' + Date.now(), scheduled_at: tomorrow(), timezone: 'Asia/Kolkata' } })
    expect(r.ok()).toBe(true); m = await r.json()
  })
  test.afterAll(async () => { if (m) await host.delete('/api/meetings/' + m.id); await host.dispose(); await guest.dispose() })
  const wait = (name, dev) => guest.post('/api/guest-join/' + m.room_uuid, { data: { display_name: name, device_id: dev } })
  const row = async (qs) => (await (await host.get('/api/meetings' + qs)).json()).find(x => x.id === m.id)

  test('two guests on the waiting screen are counted for the host', async () => {
    for (const [n, d] of [['Wait One', 't59-a'], ['Wait Two', 't59-b'], ['Wait One', 't59-a']]) {
      const r = await wait(n, d); expect(r.status()).toBe(400); expect((await r.json()).error).toBe('Meeting not started yet')
    }
    const x = await row('?with=invited')
    expect(x.waiting_count).toBe(2)                                   // the same person asking twice counts once
    expect(x.waiting_names).toEqual(expect.arrayContaining(['Wait One', 'Wait Two']))
    expect((await row('')).waiting_count).toBeUndefined()            // old dashboard's list unchanged
  })

  test('the host sees "2 waiting for you" on the new dashboard', async ({ browser }) => {
    const ctx = await browser.newContext()
    await ctx.addCookies([{ name: 'meet_token', value: pass(), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
    const page = await ctx.newPage()
    await wait('Wait One', 't59-a'); await wait('Wait Two', 't59-b')
    await page.goto(`${BASE}/dashboard#upcoming`)
    await expect(page.locator('.row', { hasText: m.title }).locator('.chip.wait')).toHaveText('2 waiting for you', { timeout: 10000 })
    await ctx.close()
  })

  test('they drop off once they stop asking (closed the page)', async () => {
    await new Promise(r => setTimeout(r, 16500))
    expect((await row('?with=invited')).waiting_count || 0).toBe(0)
  })
})
