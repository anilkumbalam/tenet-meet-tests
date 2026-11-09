// 61 - Text check on every screen (8 Nov).
// Opens the main screens as each kind of person, on desktop and phone, and fails if the visible text (or a
// tooltip, placeholder or label) shows a programming slip: undefined, null, NaN, Invalid Date, [object Object],
// ${...} or {{...}}; or names a supplier (Zoho, LiveKit, Hetzner) or says "moderator" (we say co-host).
// Meeting titles, names and email addresses are what people typed, so they are only checked for the slips.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const pass = (isAdmin = true) => jwt.sign({ email: HOST, displayName: H.HOST_DISPLAY || 'Host', isAdmin }, KEY, { expiresIn: '1h' })
const istIn = mins => new Date(Date.now() + mins * 60000 + 5.5 * 3600000).toISOString().slice(0, 16).replace('T', ' ') + ':00'

const SLIPS = [[/\bundefined\b/, 'undefined'], [/\bnull\b/, 'null'], [/\bNaN\b/, 'NaN'], [/Invalid Date/i, 'Invalid Date'],
  [/\[object \w+\]/, '[object …]'], [/\$\{|\{\{|\}\}/, 'template braces']]
const NOT_FOR_PEOPLE = /zoho|livekit|hetzner|moderator/i

// Every visible piece of text on the page, and whether it is something people typed (titles, names, emails)
const COLLECT = () => {
  const shown = e => { const r = e.getBoundingClientRect(), s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0' }
  const typed = (e, t) => /@/.test(t) || Boolean(e.closest('.meeting-title, #usersTableWrap, .chip.wait, input, textarea, [contenteditable], #right-panel, .tp-name, [data-user-text]'))
  const out = [{ t: document.title, typed: false }]
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
  while (w.nextNode()) {
    const n = w.currentNode, t = (n.nodeValue || '').trim(), e = n.parentElement
    if (!t || !e || ['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE'].includes(e.tagName) || !shown(e)) continue
    out.push({ t, typed: typed(e, t) })
  }
  document.querySelectorAll('[title], [placeholder], [aria-label], input[type=button], input[type=submit], button[value]').forEach(e => {
    if (!shown(e)) return
    for (const a of ['title', 'placeholder', 'aria-label', 'value']) { const v = e.getAttribute(a); if (v) out.push({ t: v, typed: typed(e, v) || (a === 'title' && e.classList.contains('wait')) }) }
  })
  return out
}

const seen = []
async function scan (page, label) {
  await page.waitForTimeout(1200)                                           // let late updates land
  const items = await page.evaluate(COLLECT)
  const hits = []
  for (const { t, typed } of items) {
    for (const [rx, what] of SLIPS) if (rx.test(t)) hits.push(what + ': "' + t.slice(0, 90) + '"')
    if (!typed && NOT_FOR_PEOPLE.test(t)) hits.push('word not for people: "' + t.slice(0, 90) + '"')
  }
  seen.push(label + ' (' + items.length + ' texts)')
  expect.soft([...new Set(hits)], label + ': odd text on screen').toEqual([])
}

async function ctxFor (browser, who, device = H.DESKTOP) {                 // who: 'out' | 'admin' | 'member'
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...device })
  if (who !== 'out') await ctx.addCookies([{ name: 'meet_token', value: pass(who === 'admin'), domain: new URL(BASE).hostname, path: '/', httpOnly: true, secure: BASE.startsWith('https'), sameSite: 'Lax' }])
  return ctx
}
async function dashboard (browser, who, device) {
  const ctx = await ctxFor(browser, who, device), page = await ctx.newPage()
  await page.goto(BASE + '/dashboard?dash=4#today')
  await page.waitForFunction(() => document.querySelector('.tab-btn') && !/…|Loading/.test((document.getElementById('heroName') || {}).textContent || ''), null, { timeout: 20000 })
  return { ctx, page }
}

test.describe.serial('61 - Text check on every screen', () => {
  test.setTimeout(240000)
  let api, later
  const made = [], open = []
  test.beforeAll(async () => {
    api = await request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + pass() } })
    later = await (await api.post('/api/meetings', { data: { title: 'T61 later ' + Date.now(), scheduled_at: istIn(20), timezone: 'Asia/Kolkata', duration_minutes: 30 } })).json()
    made.push(later.id)
  })
  test.afterAll(async () => {
    for (const x of open) await x.browser.close().catch(() => {})
    for (const id of made) { await api.post('/api/meetings/' + id + '/end').catch(() => {}); await api.delete('/api/meetings/' + id).catch(() => {}) }
    await api.dispose()
    console.log('[61] screens checked: ' + seen.length + '\n  ' + seen.join('\n  '))
  })

  test('signed out: sign-in page, dashboard, guest link (desktop and phone)', async ({ browser }) => {
    for (const [dev, d] of [['desktop', H.DESKTOP], ['phone', H.PHONE]]) {
      const ctx = await ctxFor(browser, 'out', d), page = await ctx.newPage()
      await page.goto(BASE + '/'); await scan(page, 'signed out, start page, ' + dev)
      await page.goto(BASE + '/dashboard?dash=4'); await scan(page, 'signed out, dashboard, ' + dev)
      await page.goto(BASE + '/join/' + later.room_uuid); await expect(page.locator('#n')).toBeVisible({ timeout: 15000 })
      await scan(page, 'guest link, name form, ' + dev)
      await page.goto(BASE + '/join/00000000-0000-4000-8000-000000000000'); await scan(page, 'guest link that does not exist, ' + dev)
      await ctx.close()
    }
  })

  test('admin: every dashboard tab, Users and the schedule form (desktop and phone)', async ({ browser }) => {
    for (const [dev, d] of [['desktop', H.DESKTOP], ['phone', H.PHONE]]) {
      const { ctx, page } = await dashboard(browser, 'admin', d)
      for (const tab of ['today', 'upcoming', 'ended', 'all', 'admin']) {
        await page.evaluate(t => window.showTab(t), tab)
        await scan(page, 'admin, ' + (tab === 'admin' ? 'Users' : tab) + ' tab, ' + dev)
      }
      await page.evaluate(() => window.showTab('today'))
      await page.evaluate(() => window.openSchedule())
      await scan(page, 'admin, schedule form, ' + dev)
      const more = page.getByText(/More options/i).first()
      if (await more.isVisible().catch(() => false)) { await more.click(); await scan(page, 'admin, schedule form with more options, ' + dev) }
      await ctx.close()
    }
  })

  test('member (not admin): dashboard tabs', async ({ browser }) => {
    const { ctx, page } = await dashboard(browser, 'member')
    for (const tab of ['today', 'upcoming', 'ended']) { await page.evaluate(t => window.showTab(t), tab); await scan(page, 'member, ' + tab + ' tab') }
    await ctx.close()
  })

  test('guest early: waiting screen with countdown, and the host sees the waiting tag', async ({ browser }) => {
    for (const [dev, d] of [['desktop', H.DESKTOP], ['phone', H.PHONE]]) {
      const b = await H.launch(); open.push({ browser: b })
      const page = await (await b.newContext({ ignoreHTTPSErrors: true, ...d })).newPage()
      await page.goto(BASE + '/join/' + later.room_uuid)
      await page.locator('#n').fill('Guest Tara ' + dev)
      await page.locator('#btn').click()
      await expect(page.locator('#waiting')).toBeVisible({ timeout: 20000 })
      await scan(page, 'guest waiting (countdown), ' + dev)
    }
    const { ctx, page } = await dashboard(browser, 'admin')
    await expect(page.locator('.chip.wait').first()).toBeVisible({ timeout: 15000 })
    await scan(page, 'admin, today tab with guests waiting')
    await ctx.close()
  })

  test('in the meeting: host and guest, People panel, then the guest finish screen', async () => {
    const m = await (await api.post('/api/meetings', { data: { title: 'T61 now ' + Date.now() } })).json(); made.push(m.id)
    const host = await H.joinAsHost(m.id); open.push(host)
    const guest = await H.joinAsGuest(m.room_uuid, 'Guest Tara'); open.push(guest)
    await host.page.waitForTimeout(3000)
    await scan(host.page, 'host in the meeting')
    await scan(guest.page, 'guest in the meeting')
    await H.openPanel(host.page); await scan(host.page, 'host, People panel open')
    const phone = await H.joinAsGuest(m.room_uuid, 'Guest Phone', H.PHONE); open.push(phone)
    await scan(phone.page, 'guest in the meeting, phone')
    expect((await api.post('/api/meetings/' + m.id + '/end')).ok()).toBe(true)
    await guest.page.waitForTimeout(6000)
    await scan(guest.page, 'guest after the meeting ended')
    await scan(phone.page, 'guest after the meeting ended, phone')
  })
})
