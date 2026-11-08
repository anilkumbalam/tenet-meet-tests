// 25 - Meeting page v3: strict security policy (no inline scripts) and the page version switch.
// v3 is served with script-src 'self' (no 'unsafe-inline'); v2 keeps the relaxed policy; v1 is retired (?ui=1 gives v2);
// only one policy header per page (the app sends it, not nginx). In a v3 meeting every button works and the
// browser blocks nothing. The test server's IP is in MEET_UI_V4_IPS, so the whole suite runs on v4 (the redesign);
// v3 (strict too) is still checked with ?ui=3.
const { test, expect, request } = require('./guard')
const H = require('./meet-helpers')

let meetingId, roomUuid, api
const cspOf = r => r.headersArray().filter(h => h.name.toLowerCase() === 'content-security-policy').map(h => h.value)
const scriptSrc = v => (/script-src ([^;]*)/.exec(v) || [])[1] || ''

test.describe.serial('25 - Meeting page v3 (strict security policy)', () => {
  test.setTimeout(120000)
  test.beforeAll(async ({ browser }) => { ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'v3-strict')) })
  test.afterAll(async () => {
    if (api) { await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {}); await api.close().catch(() => {}) }
  })

  test('page versions and their security policies', async () => {
    const r = await request.newContext({ ignoreHTTPSErrors: true })
    try {
      const v3 = await r.get(`${H.BASE_URL}/meeting/${roomUuid}`)
      expect(v3.headers()['x-meet-ui'], 'test server gets v4 (redesign)').toBe('4')
      expect(cspOf(v3).length, 'one policy header').toBe(1)
      expect(scriptSrc(cspOf(v3)[0]), 'v4: no inline scripts allowed').toBe("'self'")
      const v2 = await r.get(`${H.BASE_URL}/meeting/${roomUuid}?ui=2`)
      expect(v2.headers()['x-meet-ui']).toBe('2')
      expect(scriptSrc(cspOf(v2)[0])).toContain("'unsafe-inline'")
      const v3b = await r.get(`${H.BASE_URL}/meeting/${roomUuid}?ui=3`)    // v3: what everyone else gets
      expect(v3b.headers()['x-meet-ui'], 'v3 still served').toBe('3')
      expect(scriptSrc(cspOf(v3b)[0]), 'v3: no inline scripts allowed').toBe("'self'")
      await r.get(`${H.BASE_URL}/meeting/${roomUuid}?ui=4`)                 // back to v4 for this context
      const v1 = await (await request.newContext({ ignoreHTTPSErrors: true })).get(`${H.BASE_URL}/meeting/${roomUuid}?ui=1`)
      expect(v1.headers()['x-meet-ui'], 'v1 retired: ?ui=1 is ignored').not.toBe('1')
      for (const p of ['/start', `/join/${roomUuid}`]) expect(cspOf(await r.get(H.BASE_URL + p)).length, p + ': one policy header').toBe(1)
    } finally { await r.dispose() }
  })

  test('v3 meeting: every button works and the browser blocks nothing', async () => {
    const host = await H.joinAsHost(meetingId), guest = await H.joinAsGuest(roomUuid, 'Guest V3')
    const blocked = []
    for (const p of [host.page, guest.page]) p.on('console', m => { if (/Content Security Policy|Refused to/i.test(m.text())) blocked.push(m.text().slice(0, 160)) })
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })   // pre-join Join button worked (bound, not inline)
      expect(await host.page.evaluate(() => document.querySelectorAll('[onclick]').length), 'no inline handlers on the page').toBe(0)
      for (const [btn, cls] of [['#vbtn-speaker', 'view-speaker'], ['#vbtn-strip', 'view-strip']]) {
        await H.chooseView(host.page, btn)
        await expect.poll(() => host.page.evaluate(() => document.body.className), { timeout: 5000 }).toContain(cls)
      }
      await H.chooseView(host.page, '#vbtn-grid')                            // grid is the plain layout (no view- class)
      await expect.poll(() => host.page.evaluate(() => /view-/.test(document.body.className)), { timeout: 5000 }).toBe(false)
      await host.page.locator('#btn-lock').click()                             // Lock button (was unreachable before)
      await expect.poll(async () => (await H.meetingStatus(api, meetingId)).lock_room, { timeout: 10000 }).toBe(true)
      await host.page.locator('#btn-lock').click()
      await expect.poll(async () => (await H.meetingStatus(api, meetingId)).lock_room, { timeout: 10000 }).toBe(false)
      await host.page.locator('#btn-copy-link').click()
      await host.page.waitForTimeout(500)
      expect(blocked, 'blocked by the security policy').toEqual([])
      await H.expectHealthy(host, guest)
    } finally { for (const p of [guest, host]) await p.browser.close().catch(() => {}) }
  })
})
