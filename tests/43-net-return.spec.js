// 43 - Network return and old links (6 Nov).
// Old links: an ended, missed or unknown meeting shows its final screen at once - no camera, no form. A live meeting
// still shows the usual join page.
// Network return (Anil's Wi-Fi off / on test of 5 Nov took over a minute to get back): offline -> "You're offline"
// bar; network back but the meeting stuck -> the page rejoins by itself (fresh pass, same mic / camera; a guest's
// join page joins without a click), no Connection lost screen; the meeting server not answering -> Rejoin button.
// The test browsers never really lose the media connection, so "stuck" is forced as in test 41.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

async function plainPage (browser) {                 // a fresh guest browser that counts camera / mic requests
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  await ctx.addInitScript(() => {
    window.__t43Media = 0
    if (navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      const orig = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = c => { window.__t43Media++; return orig(c) }
    }
  })
  return { ctx, page: await ctx.newPage() }
}
async function expectFinal (page, heading, text) {
  await expect(page.locator('h1')).toHaveText(heading, { timeout: 10000 })
  await expect(page.locator('.jv-card')).toContainText(text)
  await expect(page.locator('#wv-video'), 'no camera preview').toHaveCount(0)
  await expect(page.locator('#btn'), 'no Join button').toHaveCount(0)
  await expect(page.locator('#n'), 'no name box').toHaveCount(0)
  expect(await page.evaluate(() => window.__t43Media), 'camera / mic never asked for').toBe(0)
}
async function watchLost (p) {                       // records any Connection lost screen, across reloads
  const seen = []
  await p.exposeBinding('__t43Seen', (_s, what) => { seen.push(what) })
  const arm = () => {
    const check = () => { if (document.getElementById('rj-screen')) window.__t43Seen('rj-screen') }
    new MutationObserver(check).observe(document, { childList: true, subtree: true }); check()
  }
  await p.addInitScript(arm); await p.evaluate(arm)
  return seen
}
const connected = p => p.evaluate(() => Boolean(window.__tenetRoom && String(window.__tenetRoom.state) === 'connected')).catch(() => false)
const where = async p => {                           // for failure messages: where the page stopped
  const d = await p.evaluate(() => ({ title: document.title, h: (document.querySelector('h1,h2') || {}).textContent || '', room: window.__tenetRoom ? String(window.__tenetRoom.state) : 'none', text: document.body.innerText.slice(0, 160).replace(/\s+/g, ' ') })).catch(e => ({ err: String(e) }))
  return p.url().replace(/token=[^&]+/, 'token=…') + ' | ' + JSON.stringify(d)
}

test.describe.serial('43 - Old links show their final screen at once', () => {
  test.setTimeout(120000)
  test('ended meeting: "Meeting ended", no camera, no form', async ({ browser }) => {
    const m = await H.createMeeting(browser, 'old-link')
    const r = await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`)
    expect(r.status()).toBeLessThan(300)
    const g = await plainPage(browser)
    try {
      await g.page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
      await expectFinal(g.page, 'Meeting ended', 'Please contact the host for a new link')
      await expect(g.page).toHaveTitle(/Meeting ended/)
    } finally { await g.ctx.close(); await m.api.close().catch(() => {}) }
  })
  test('missed meeting: "Meeting not available" (no "no one joined")', async ({ browser }) => {
    const m = await H.createMeeting(browser, 'old-link-missed')
    const g = await plainPage(browser)
    try {
      // a missed meeting cannot be made on demand: the server's answer is replaced for this page only
      await g.page.route('**/api/room/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ room_uuid: m.roomUuid, title: 'Missed one', final: 'missed' }) }))
      await g.page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
      await expectFinal(g.page, 'Meeting not available', 'This meeting link is no longer active')
      await expect(g.page.locator('.jv-card')).not.toContainText('no one joined')
    } finally {
      await g.ctx.close()
      await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {}); await m.api.close().catch(() => {})
    }
  })
  test('unknown link: "Meeting not found"', async ({ browser }) => {
    const g = await plainPage(browser)
    try {
      await g.page.goto(`${H.BASE_URL}/join/no-such-meeting-43`)
      await expectFinal(g.page, 'Meeting not found', 'check the link with the host')
    } finally { await g.ctx.close() }
  })
  test('server: /api/room says final only for ended meetings', async ({ browser }) => {
    const m = await H.createMeeting(browser, 'room-api')
    try {
      const live = await (await m.api.request.get(`${H.BASE_URL}/api/room/${m.roomUuid}`)).json()
      expect(live.final, JSON.stringify(live)).toBeNull()
      await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`)
      const over = await (await m.api.request.get(`${H.BASE_URL}/api/room/${m.roomUuid}`)).json()
      expect(over.final).toBe('ended')
    } finally { await m.api.close().catch(() => {}) }
  })
})

test.describe.serial('43 - Network return', () => {
  test.setTimeout(150000)
  const STAFF = 'net.return@tenetnetworks.com'
  let m, host, staff, guest
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'net-return')
    host = await H.joinAsHost(m.meetingId)
    staff = await H.joinAsStaff(m.meetingId, STAFF, 'Net Staff')
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Net')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, staff, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('live meeting: the join page still shows the preview and Join', async ({ browser }) => {
    const g = await plainPage(browser)
    try {
      await g.page.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
      await expect(g.page.locator('#btn')).toBeVisible({ timeout: 10000 })
      await expect(g.page.locator('h1')).toHaveText('Ready to join?')
    } finally { await g.ctx.close() }
  })

  test('offline: "You’re offline" bar; network back and still connected: bar goes, no reload', async () => {
    const p = staff.page
    const url = p.url()
    await p.context().setOffline(true)
    await expect(p.locator('#nr-bar')).toContainText('You’re offline', { timeout: 5000 })
    await expect(p.locator('#cw-bar')).toBeHidden()
    await p.context().setOffline(false)
    await expect(p.locator('#nr-bar')).toHaveCount(0, { timeout: 10000 })
    expect(p.url(), 'no reload').toBe(url)
    await expect(p.locator('#rj-screen')).toHaveCount(0)
  })

  test('staff: network back but stuck -> back in by itself within ~10 s, same mic, no Connection lost', async () => {
    const p = staff.page
    const seen = await watchLost(p)
    await p.locator('#btn-mic').click()                                       // mic off: must stay off after the rejoin
    await expect(p.locator('#btn-mic')).toHaveClass(/\boff\b/)
    await p.context().setOffline(true)
    await expect(p.locator('#nr-bar')).toContainText('offline', { timeout: 5000 })
    await p.evaluate(() => { window.__tenetRoom.state = 'reconnecting' })    // the 5 Nov case: the library does not recover
    const t0 = Date.now()
    await p.context().setOffline(false)
    await expect.poll(() => connected(p), { message: 'back in the meeting', timeout: 20000, intervals: [500] }).toBe(true).catch(async e => { console.log('[43] staff stopped at: ' + await where(p)); throw e })
    const secs = (Date.now() - t0) / 1000
    console.log(`[43] staff back in after ${secs.toFixed(1)} s`)
    expect(secs, 'back within about 10 s').toBeLessThan(13)
    await expect(p.locator('#btn-mic'), 'same mic state').toHaveClass(/\boff\b/, { timeout: 10000 })
    await expect(host.page.locator('#video-grid .video-tile', { hasText: 'Net Staff' })).toHaveCount(1, { timeout: 20000 })
    expect(seen, 'no Connection lost screen').toEqual([])
  })

  test('guest: network back but stuck -> back in by itself, no Join click', async () => {
    const p = guest.page
    const seen = await watchLost(p)
    await p.context().setOffline(true)
    await expect(p.locator('#nr-bar')).toContainText('offline', { timeout: 5000 })
    await p.evaluate(() => { window.__tenetRoom.state = 'reconnecting' })
    await p.context().setOffline(false)
    await expect.poll(async () => /\/meeting\//.test(p.url()) && await connected(p), { message: 'guest back in the meeting', timeout: 25000, intervals: [500] }).toBe(true).catch(async e => { console.log('[43] guest stopped at: ' + await where(p)); throw e })
    await expect(host.page.locator('#video-grid .video-tile', { hasText: 'Guest Net' })).toHaveCount(1, { timeout: 20000 })
    expect(seen, 'no Connection lost screen').toEqual([])
  })

  test('meeting server not answering when the network returns -> Connection lost with Rejoin', async () => {
    const p = staff.page
    await p.route('**/api/speedtest/ping**', r => r.abort())
    await p.context().setOffline(true)
    await expect(p.locator('#nr-bar')).toContainText('offline', { timeout: 5000 })
    await p.evaluate(() => { window.__tenetRoom.state = 'reconnecting' })
    await p.context().setOffline(false)
    await expect(p.locator('#rj-screen')).toBeVisible({ timeout: 30000 })
    await expect(p.locator('#rj-go')).toBeVisible()
    await expect(p.locator('#nr-bar')).toHaveCount(0)
    await p.unroute('**/api/speedtest/ping**')
  })
})
