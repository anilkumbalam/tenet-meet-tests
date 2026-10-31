// 20 - Security: what an outsider (no login, not in the meeting) can and cannot do, against the live site.
// A crafted join link must not get code into the page; the status address must not give out emails or
// participant numbers; guessed participant numbers must not end a meeting, mute, stop a share, or mark
// someone as left. People in the meeting (with their key) keep working, including a guest co-host ending it.
const { test, expect, request } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host, cohost, outsider
const pidOf = page => page.evaluate(() => new URLSearchParams(window.__tenetParams || location.search).get('pid'))
const statusFrom = page => page.evaluate(id => fetch('/api/meetings/' + id + '/status').then(r => r.json()), meetingId)   // the page adds its key

test.describe.serial('20 - Security (outsider)', () => {

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    outsider = await request.newContext({ ignoreHTTPSErrors: true })          // no cookies, no key
    ;({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'security'))
    host   = await H.joinAsHost(meetingId)
    cohost = await H.joinAsGuest(roomUuid, 'Guest Cohost')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [cohost, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
    if (outsider) await outsider.dispose().catch(() => {})
  })

  test('crafted join link: refused, nothing from it lands in the page', async () => {
    const r = await outsider.get(`${H.BASE_URL}/join/abc%27%2Balert(1)%2B%27`)
    expect(r.status()).toBe(404)
    expect(await r.text()).not.toContain('alert(1)')
    const ok = await outsider.get(`${H.BASE_URL}/join/${roomUuid}`)
    expect(ok.status()).toBe(200)
    expect(await ok.text()).toContain(`var roomUuid=${JSON.stringify(roomUuid)}`)
  })

  test('host makes the guest co-host (setup)', async () => {
    await H.openPanel(host.page)
    await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
    const row = host.page.locator('.participant-item').filter({ hasText: 'Guest Cohost' })
    await H.openRowMenu(row)
    await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).click()
    const gpid = await pidOf(cohost.page)
    await expect.poll(async () => String((await statusFrom(cohost.page)).moderator_pid), { timeout: 15000 }).toBe(String(gpid))
  })

  test('status address: an outsider only learns whether the meeting is on', async () => {
    const gpid = await pidOf(cohost.page)
    for (const q of ['', `?pid=${gpid}`, `?pid=${gpid}&pk=wrong`]) {
      const s = await (await outsider.get(`${H.BASE_URL}/api/meetings/${meetingId}/status${q}`)).json()
      expect(Object.keys(s), 'outsider status ' + q + ' ' + JSON.stringify(s)).toEqual(['status'])
      expect(JSON.stringify(s)).not.toContain('@')
    }
    const inside = await statusFrom(cohost.page)                    // someone in the meeting still gets everything
    expect(inside.host_email).toContain('@')
    expect(String(inside.moderator_pid)).toBe(String(gpid))
  })

  test('guessed participant numbers do nothing: end, mute, stop share, leave, heartbeat', async () => {
    const gpid = await pidOf(cohost.page), hpid = await pidOf(host.page)
    const hostId = await host.page.evaluate(() => window.__tenetRoom.localParticipant.identity)
    const B = `${H.BASE_URL}/api/meetings/${meetingId}`
    for (const pk of ['', '&pk=wrong']) {
      expect((await outsider.post(`${B}/end?pid=${gpid}${pk}`)).status(), 'end').toBe(403)
      expect((await outsider.post(`${B}/mute/${encodeURIComponent(hostId)}?pid=${gpid}${pk}`, { data: { muted: true, pid: gpid } })).status(), 'mute').toBe(403)
      expect((await outsider.post(`${B}/stop-share/${encodeURIComponent(hostId)}?pid=${gpid}${pk}`, { data: { pid: gpid } })).status(), 'stop-share').toBe(403)
      expect((await outsider.post(`${H.BASE_URL}/api/leave/${hpid}?x=1${pk}`)).status(), 'leave (host)').toBe(403)
      expect((await outsider.post(`${H.BASE_URL}/api/heartbeat/${gpid}?x=1${pk}`)).status(), 'heartbeat').toBe(403)
    }
    // nothing changed: meeting on, host still in and not muted, co-host unchanged
    const s = await H.meetingStatus(api, meetingId)
    expect(s.status).toBe('active')
    expect(String(s.moderator_pid)).toBe(String(gpid))
    const rows = await (await api.request.get(`${B}/participants`)).json()
    const hostRow = (Array.isArray(rows) ? rows : rows.participants || []).find(r => String(r.id) === String(hpid))
    if (hostRow) expect(hostRow.left_at, 'host not marked as left').toBeFalsy()
    expect(await H.roomState(host.page)).toBe('connected')
    expect(await host.page.evaluate(() => window.__tenetRoom.localParticipant.isMicrophoneEnabled)).toBe(true)
  })

  test('people in the meeting still work: heartbeat, and the guest co-host can end the meeting', async () => {
    const gpid = await pidOf(cohost.page)
    const hb = await cohost.page.evaluate(p => fetch('/api/heartbeat/' + p, { method: 'POST' }).then(r => r.status), gpid)
    expect(hb, 'heartbeat with the key').toBe(204)
    const end = await cohost.page.evaluate(id => fetch('/api/meetings/' + id + '/end', { method: 'POST' }).then(r => r.status), meetingId)
    expect(end, 'guest co-host ends the meeting').toBe(204)
    await expect.poll(async () => (await H.meetingStatus(api, meetingId)).status, { timeout: 10000 }).toBe('ended')
  })
})
