// 30 - Waiting room, the rest: outsiders and people without powers cannot run the waiting room; the waiting page
// runs under the strict policy and a reload keeps the same place; Leave takes someone off the host's list; the
// meeting ending while people wait tells them; the schedule form and create/edit save the setting; an automatic
// co-host can let people in but cannot send back or finish; the waiting room also works on the v2 meeting page.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const asPage = (page, method, path, body) => page.evaluate(([m, p, b]) =>
  fetch(p, { method: m, headers: { 'Content-Type': 'application/json' }, body: b ? JSON.stringify(b) : undefined }).then(r => r.status), [method, path, body])
const headOf = p => p.page.locator('#head')
const panelPeople = async page => { await H.openPanel(page); await page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people')) }

async function waitingMeeting (browser, prefix, extra = {}) {
  const m = await H.createMeeting(browser, prefix)
  const r = await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: { waiting_room: 1, ...extra } })
  expect(r.status()).toBeLessThan(300)
  return m
}
async function cleanup (m, people) {
  if (m && m.api) { await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {}) }
  for (const p of people) if (p) await p.browser.close().catch(() => {})
  if (m && m.api) await m.api.close().catch(() => {})
}

test.describe.serial('30 - Waiting room: access, waiting page, leaving, meeting end', () => {
  test.setTimeout(180000)
  let m, host
  const people = []
  const rowFor = name => host.page.locator('#wr-box .wr-row', { hasText: name })

  test.beforeAll(async ({ browser }) => {
    m = await waitingMeeting(browser, 'wr-more')
    host = await H.joinAsHost(m.meetingId)
    await panelPeople(host.page)
    await expect(host.page.locator('#wr-switch')).toBeChecked({ timeout: 15000 })
  })
  test.afterAll(async () => { await cleanup(m, [...people, host]) })

  test('outsiders and other staff cannot see or run the waiting room; bad links give 404', async ({ browser }) => {
    const out = await browser.newContext({ ignoreHTTPSErrors: true })
    const staff = await browser.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(staff, 'other.staff@tenetnetworks.com', 'Other Staff')
    const id = m.meetingId, B = H.BASE_URL
    try {
      for (const [who, ctx] of [['outsider', out], ['other staff', staff]]) {
        const calls = [
          ['GET', `/api/meetings/${id}/waiting`], ['POST', `/api/meetings/${id}/waiting-room`, { enabled: false }],
          ['POST', `/api/meetings/${id}/waiting/admit`, {}], ['POST', `/api/meetings/${id}/waiting/deny`, { ids: [1] }],
          ['POST', `/api/meetings/${id}/waiting/message`, { text: 'hello' }],
          ['POST', `/api/meetings/${id}/send-back/someone`], ['POST', `/api/meetings/${id}/finish/someone`],
        ]
        for (const [method, path, data] of calls) {
          const r = method === 'GET' ? await ctx.request.get(B + path) : await ctx.request.post(B + path, { data: data || {} })
          expect([401, 403], `${who}: ${method} ${path}`).toContain(r.status())
        }
      }
      const list = await (await m.api.request.get(`${B}/api/meetings/${id}/waiting`)).json()
      expect(list.enabled, 'still on after the refused calls').toBe(true)
      expect((await out.request.get(`${B}/wait/not-a-key`)).status()).toBe(404)
      expect((await out.request.get(`${B}/api/waiting/${'0'.repeat(32)}`)).status()).toBe(404)
      expect((await out.request.get(`${B}/api/waiting/abc`)).status()).toBe(404)
      expect([403, 404]).toContain((await m.api.request.get(`${B}/api/meetings/abc/waiting`)).status())
    } finally { await out.close(); await staff.close() }
  })

  test('waiting page: strict policy, nothing blocked; a reload or a second join keeps the same place', async () => {
    const g = await H.openAsGuest(m.roomUuid, 'Guest Rhea', H.DESKTOP, 'test-dev-rhea-0001'); people.push(g)
    expect(g.body.lobby, JSON.stringify(g.body)).toBe(true)
    const first = new URL(g.page.url()).pathname
    const errors = []; g.page.on('console', x => { if (x.type() === 'error') errors.push(x.text()) })
    const resp = await g.page.reload({ waitUntil: 'load' })
    const scriptSrc = (resp.headers()['content-security-policy'] || '').split(';').map(s => s.trim()).find(s => s.startsWith('script-src')) || ''
    expect(scriptSrc).toBe("script-src 'self'")
    await expect(headOf(g)).toHaveText('Waiting to join')
    await expect(g.page.locator('#title')).not.toBeEmpty({ timeout: 10000 })
    expect(errors.filter(e => /Content Security Policy|Refused to/i.test(e)), 'browser blocked something').toEqual([])
    expect(new URL(g.page.url()).pathname).toBe(first)
    const again = await (await g.page.request.post(`${H.BASE_URL}/api/guest-join/${m.roomUuid}`, { data: { display_name: 'Guest Rhea', device_id: 'test-dev-rhea-0001' } })).json()
    expect(again.url, 'joining again from the same device: same place in the queue').toBe(first)
    await expect(rowFor('Guest Rhea')).toHaveCount(1, { timeout: 10000 })
  })

  test('Leave on the waiting page takes them off the host\'s list', async () => {
    const g = people.find(p => p.name === 'Guest Rhea')
    await g.page.locator('#leave').click()
    await expect(headOf(g)).toHaveText('You left the waiting room')
    await expect(rowFor('Guest Rhea')).toHaveCount(0, { timeout: 10000 })
  })

  test('someone let in has no waiting-room powers', async () => {
    const g = await H.openAsGuest(m.roomUuid, 'Guest Sam'); people.push(g)
    await expect(rowFor('Guest Sam')).toBeVisible({ timeout: 10000 })
    await rowFor('Guest Sam').locator('.wr-admit').click()
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(g.page, 'Guest Sam')
    const id = m.meetingId
    expect(await asPage(g.page, 'GET', `/api/meetings/${id}/waiting`), 'list').toBe(403)
    expect(await asPage(g.page, 'POST', `/api/meetings/${id}/waiting/admit`, {}), 'admit').toBe(403)
    expect(await asPage(g.page, 'POST', `/api/meetings/${id}/waiting-room`, { enabled: false }), 'switch off').toBe(403)
    expect(await asPage(g.page, 'POST', `/api/meetings/${id}/waiting/message`, { text: 'x' }), 'message').toBe(403)
    await H.expectHealthy(host, g)
  })

  test('the meeting ends while someone waits: their page says so', async () => {
    const g = await H.openAsGuest(m.roomUuid, 'Guest Tara'); people.push(g)
    await expect(rowFor('Guest Tara')).toBeVisible({ timeout: 10000 })
    const r = await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/end`)
    expect(r.status()).toBeLessThan(300)
    await expect(headOf(g)).toHaveText('Meeting ended', { timeout: 10000 })
  })
})

test.describe.serial('30 - Waiting room: setting, automatic co-host, v2 page', () => {
  test.setTimeout(180000)

  test('schedule form offers the switch; create and edit save it', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(ctx)
    const page = await ctx.newPage(), B = H.BASE_URL
    let id
    try {
      await page.goto(`${B}/dashboard`, { waitUntil: 'domcontentloaded' })
      await page.waitForFunction(() => typeof window.openSchedule === 'function' && window.TenetWaitingSetting)
      await page.evaluate(() => openSchedule())
      await expect(page.locator('#mWaitingRoom')).toBeVisible()
      await expect(page.locator('#mWaitingRoom')).not.toBeChecked()
      await expect(page.locator('label:has(#mWaitingRoom)')).toContainText('Waiting room: people wait until the host lets them in')
      const created = await (await ctx.request.post(`${B}/api/meetings`, { data: { title: `wr-form-${Date.now().toString(36)}`, duration_minutes: 30, waiting_room: 1 } })).json()
      id = created.id
      expect((await (await ctx.request.get(`${B}/api/meetings/${id}/waiting`)).json()).enabled, 'saved on create').toBe(true)
      expect((await ctx.request.patch(`${B}/api/meetings/${id}`, { data: { waiting_room: 0 } })).status()).toBeLessThan(300)
      expect((await (await ctx.request.get(`${B}/api/meetings/${id}/waiting`)).json()).enabled, 'changed by edit').toBe(false)
    } finally {
      if (id) { await ctx.request.post(`${B}/api/meetings/${id}/cancel`).catch(() => {}); await ctx.request.delete(`${B}/api/meetings/${id}`).catch(() => {}) }
      await ctx.close()
    }
  })

  test('automatic co-host can let people in but cannot send back or finish', async ({ browser }) => {
    const STAFF = 'wr.cohost@tenetnetworks.com'
    const m = await waitingMeeting(browser, 'wr-auto', { invited_emails: STAFF })
    const people = []
    try {
      const host = await H.joinAsHost(m.meetingId); people.push(host)
      const g = await H.openAsGuest(m.roomUuid, 'Guest Uma'); people.push(g)
      expect(g.body.lobby).toBe(true)
      const B = H.BASE_URL, list = async () => (await m.api.request.get(`${B}/api/meetings/${m.meetingId}/waiting`)).json()
      await expect.poll(async () => (await list()).waiting.length, { timeout: 10000 }).toBe(1)
      const wid = (await list()).waiting[0].id
      expect((await m.api.request.post(`${B}/api/meetings/${m.meetingId}/waiting/admit`, { data: { ids: [wid] } })).status()).toBe(200)
      await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
      await H.finishJoin(g.page, 'Guest Uma')
      const staff = await H.joinAsStaff(m.meetingId, STAFF, 'Cohost Staff'); people.push(staff)
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      const uma = ((await list()).admitted.find(a => a.name === 'Guest Uma') || {}).identity
      expect(uma, 'Guest Uma listed as let in').toBeTruthy()
      await host.page.goto('about:blank')                                                 // host drops out
      await expect.poll(async () => { const s = await H.meetingStatus(m.api, m.meetingId); return [s.moderator_email, s.moderator_auto] }, { timeout: 30000 }).toEqual([STAFF, true])
      const id = m.meetingId, enc = encodeURIComponent(uma)
      const seen = await staff.page.evaluate(i => fetch('/api/meetings/' + i + '/waiting').then(r => r.json()), id)
      expect(seen.canFinish, 'automatic co-host is not offered Finish').toBe(false)
      expect(await asPage(staff.page, 'POST', `/api/meetings/${id}/send-back/${enc}`), 'send back refused').toBe(403)
      expect(await asPage(staff.page, 'POST', `/api/meetings/${id}/finish/${enc}`), 'finish refused').toBe(403)
      expect(await asPage(staff.page, 'POST', `/api/meetings/${id}/waiting/admit`, { ids: [] }), 'can still let people in').toBe(200)
      expect(await H.roomState(g.page), 'guest still in the meeting').toBe('connected')
    } finally { await cleanup(m, people) }
  })

  test('v2 meeting page: the host sees the waiting room and can let people in', async ({ browser }) => {
    const m = await waitingMeeting(browser, 'wr-v2')
    const people = []
    try {
      const host = await H.joinAsHost(m.meetingId); people.push(host)
      await host.ctx.addCookies([{ name: 'meet_ui', value: '2', domain: new URL(H.BASE_URL).hostname, path: '/' }])
      const resp = await host.page.reload({ waitUntil: 'domcontentloaded' })
      expect(resp.headers()['x-meet-ui'], 'host is on v2').toBe('2')
      await H.finishJoin(host.page, 'Host')
      await panelPeople(host.page)
      await expect(host.page.locator('#wr-switch')).toBeChecked({ timeout: 15000 })
      const g = await H.openAsGuest(m.roomUuid, 'Guest Vik'); people.push(g)
      const row = host.page.locator('#wr-box .wr-row', { hasText: 'Guest Vik' })
      await expect(row).toBeVisible({ timeout: 10000 })
      await row.locator('.wr-admit').click()
      await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
      await H.finishJoin(g.page, 'Guest Vik')
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await H.expectHealthy(host, g)
    } finally { await cleanup(m, people) }
  })
})
