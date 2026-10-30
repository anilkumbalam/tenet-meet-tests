// 15 - Safety net for future changes: module files load, no token left in the address bar, the dashboard
// count matches the people in the call (also after a reload), protected actions refuse outsiders and
// plain guests, and the meeting works in Firefox and on an iPhone (Safari engine).
// Every test also checks that no page threw an uncaught error or froze.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api
let host, g1, g2

const inMeeting = async () => {
  const r = await api.request.get(`${H.BASE_URL}/api/meetings`)
  const list = r.ok() ? await r.json() : []
  const m = (Array.isArray(list) ? list : (list.meetings || [])).find(x => String(x.id) === String(meetingId))
  return m ? Number(m.active_count) : -1
}
const notAllowed = st => st < 200 || st >= 300          // anything but success (401, 403, redirect to sign-in…)

test.describe.serial('15 - Health and safety net', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'health-test'))
    host = await H.joinAsHost(meetingId)
    g1   = await H.joinAsGuest(roomUuid, 'Guest One')
    g2   = await H.joinAsGuest(roomUuid, 'Guest Two')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
  })

  test.afterEach(async () => { await H.expectHealthy(host, g1, g2) })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [g1, g2, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('every script and stylesheet the meeting page and dashboard include is reachable', async () => {
    const pages = [new URL(host.page.url()).pathname, '/dashboard']
    const bad = []
    let checked = 0
    for (const path of pages) {
      const html = await (await api.request.get(`${H.BASE_URL}${path}`)).text()
      const refs = [...html.matchAll(/(?:src|href)="(\/[^"#]+\.(?:js|css)(?:\?[^"]*)?)"/g)].map(m => m[1])
      expect(refs.length, `includes found on ${path}`).toBeGreaterThan(0)
      for (const ref of [...new Set(refs)]) {
        const r = await api.request.get(`${H.BASE_URL}${ref}`)
        const type = r.headers()['content-type'] || ''
        const want = ref.split('?')[0].endsWith('.css') ? /css/ : /javascript/
        checked++
        if (r.status() !== 200 || want.test(type) === false) bad.push(`${path} -> ${ref}: ${r.status()} ${type}`)
      }
    }
    expect(bad, `${checked} files checked`).toEqual([])
  })

  test('every page module is present with the functions others rely on (no name clashes)', async () => {
    const want = {
      TenetChat: ['add', 'clearUnread', 'init'],          // js/meeting/chat.js (v2)
      TenetPeopleList: ['render'],                        // js/meeting/people.js (v2)
      TenetTiles: ['id', 'fill', 'setAudio', 'attach', 'detach'],   // js/meeting/tiles.js (v2)
      TenetPeople: ['setTab', 'refresh'],                 // people-panel.js
      TenetRejoin: ['show'],                              // rejoin.js
      TenetWakeLock: ['active'],                          // wake-lock.js
      TenetShareLayout: ['place'],                        // share-layout.js
    }
    const ui = (await (await api.request.get(`${H.BASE_URL}${new URL(host.page.url()).pathname}`)).headers())['x-meet-ui']
    const missing = await host.page.evaluate(w => Object.entries(w).flatMap(([g, fns]) => {
      const o = window[g]
      if (o == null) return [g + ' missing']
      return fns.filter(f => typeof o[f] !== 'function').map(f => g + '.' + f + ' is not a function (name clash?)')
    }), ui === '2' ? want : Object.fromEntries(Object.entries(want).filter(([g]) => !['TenetChat', 'TenetPeopleList', 'TenetTiles'].includes(g))))
    expect(missing, 'served UI v' + ui).toEqual([])
  })

  test('no access pass (token) or participant id left in the address bar', async () => {
    for (const x of [host, g1, g2]) {
      const u = x.page.url()
      expect(u, x.name).not.toMatch(/[?&](token|pid)=/)
    }
  })

  test('dashboard count matches the people in the call, also after a reload and a leave', async () => {
    await expect.poll(inMeeting, { timeout: 20000 }).toBe(3)
    await g1.page.reload({ waitUntil: 'domcontentloaded' })        // a reload sends "leave" for a moment
    await H.finishJoin(g1.page, 'Guest One reload')
    await expect.poll(() => H.roomState(g1.page), { timeout: 30000 }).toBe('connected')
    await expect.poll(inMeeting, { timeout: 45000 }).toBe(3)       // counted back in
    await g2.page.goto('about:blank')                               // Guest Two really leaves
    await expect.poll(inMeeting, { timeout: 20000 }).toBe(2)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test('protected actions refuse outsiders and plain guests', async ({ playwright }) => {
    const anon = await playwright.request.newContext({ ignoreHTTPSErrors: true, maxRedirects: 0 })
    const gpid = await g1.page.evaluate(() => new URLSearchParams(window.__tenetParams || location.search).get('pid'))
    expect(gpid, 'guest participant id').toBeTruthy()
    const host_id = encodeURIComponent(H.HOST_EMAIL)
    const B = `${H.BASE_URL}/api/meetings/${meetingId}`
    const tries = [
      ['outsider: mute host',           () => anon.post(`${B}/mute/${host_id}`)],
      ['outsider: remove host',         () => anon.post(`${B}/kick/${host_id}`)],
      ['outsider: make co-host',        () => anon.post(`${B}/moderator`, { data: { identity: 'x' } })],
      ['outsider: stop a share',        () => anon.post(`${B}/stop-share/${host_id}`)],
      ['outsider: lock room',           () => anon.post(`${B}/lock`, { data: { lock_room: 1 } })],
      ['outsider: end meeting',         () => anon.post(`${B}/end`)],
      ['guest: mute host',              () => anon.post(`${B}/mute/${host_id}?pid=${gpid}`)],
      ['guest: stop a share',           () => anon.post(`${B}/stop-share/${host_id}?pid=${gpid}`)],
      ['guest: end meeting',            () => anon.post(`${B}/end?pid=${gpid}`)],
    ]
    const allowed = []
    for (const [what, call] of tries) {
      const r = await call()
      if (notAllowed(r.status()) === false) allowed.push(`${what} -> ${r.status()}`)
    }
    await anon.dispose()
    expect(allowed, 'actions that should have been refused').toEqual([])
    const s = await H.meetingStatus(api, meetingId)
    expect(s.status, 'meeting still running').not.toBe('ended')
    expect(Number(s.lock_room || 0), 'room not locked').toBe(0)
  })

  test('Firefox guest: joins, sees everyone, sees a screen share', async () => {
    test.skip(await H.engineAvailable('firefox') === false, 'Firefox not installed: npx playwright install --with-deps firefox')
    const ff = await H.joinAsGuest(roomUuid, 'Guest Firefox', H.DESKTOP, 'firefox')
    try {
      await expect.poll(() => H.roomState(ff.page), { timeout: 30000 }).toBe('connected')
      // sees everyone: same number of tiles as the host (independent of which tests ran before)
      await expect.poll(async () => (await ff.page.locator('#video-grid .video-tile').count()) - (await host.page.locator('#video-grid .video-tile').count()), { timeout: 30000 }).toBe(0)
      expect(await host.page.locator('#video-grid .video-tile').count()).toBeGreaterThanOrEqual(3)
      await host.page.locator('#btn-screen').click()
      await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(true)
      await expect(ff.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
      await expect.poll(() => ff.page.evaluate(() => { const v = document.querySelector('#screenshare-main video'); return v ? v.videoWidth : 0 }), { timeout: 20000 }).toBeGreaterThan(0)
      expect(await H.clickable(ff.page, '#btn-mic')).toBe('ok')
      await host.page.locator('#btn-screen').click()
      await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(false)
      await H.expectHealthy(ff)
    } finally { await ff.browser.close().catch(() => {}) }
  })

  test('iPhone guest (Safari engine): joins, share fills the screen, page fits the phone', async () => {
    test.skip(await H.engineAvailable('webkit') === false, 'WebKit not installed: npx playwright install --with-deps webkit')
    const ip = await H.joinAsGuest(roomUuid, 'Guest iPhone', H.IPHONE, 'webkit')
    try {
      await expect.poll(() => H.roomState(ip.page), { timeout: 30000 }).toBe('connected')
      // sees everyone: same number of tiles as the host (independent of which tests ran before)
      await expect.poll(async () => (await ip.page.locator('#video-grid .video-tile').count()) - (await host.page.locator('#video-grid .video-tile').count()), { timeout: 30000 }).toBe(0)
      expect(await host.page.locator('#video-grid .video-tile').count()).toBeGreaterThanOrEqual(3)
      await host.page.locator('#btn-screen').click()
      await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(true)
      await expect(ip.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
      await expect(ip.page.locator('#screenshare-main video')).toHaveCount(1, { timeout: 20000 })
      await ip.page.waitForTimeout(1200)
      const s = await ip.page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
      expect(s.sw, JSON.stringify(s)).toBeLessThanOrEqual(s.iw + 1)
      await host.page.locator('#btn-screen').click()
      await expect.poll(() => H.isSharing(host.page), { timeout: 20000 }).toBe(false)
      await expect(ip.page.locator('#screenshare-overlay')).not.toHaveClass(/active/, { timeout: 15000 })
      await H.expectHealthy(ip)
    } finally { await ip.browser.close().catch(() => {}) }
  })
})
