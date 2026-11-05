// 29 - Waiting room: with it on, guests wait on a separate page (no connection to the meeting) until the host lets
// them in; invited staff go straight in, other staff wait; the host can turn people away, message the waiting room,
// send someone back to wait, or finish with them; turning the waiting room off lets everyone in; someone let in
// later does not see files shared before they joined; someone sent back sees "Back in the waiting room".
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host
const people = []
const INVITED = 'invited.staff@tenetnetworks.com'
const rowFor = name => host.page.locator('#wr-box .wr-row', { hasText: name })
const headOf = p => p.page.locator('#head')

test.describe.serial('29 - Waiting room', () => {
  test.setTimeout(240000)
  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'waiting'))
    const r = await api.request.patch(`${H.BASE_URL}/api/meetings/${meetingId}`, { data: { waiting_room: 1, invited_emails: INVITED } })
    expect(r.status()).toBeLessThan(300)
    host = await H.joinAsHost(meetingId)                                   // the host goes straight in
    host.page.on('dialog', d => d.accept(d.type() === 'prompt' ? 'We will start in 2 minutes' : undefined))
    await H.openPanel(host.page); await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
    await expect(host.page.locator('#wr-switch')).toBeChecked({ timeout: 15000 })
  })
  test.afterAll(async () => {
    if (api) { await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {}); await api.close().catch(() => {}) }
    for (const p of [...people, host]) if (p) await p.browser.close().catch(() => {})
  })

  test('a guest waits on the waiting page; the host sees them and lets them in', async () => {
    const g = await H.openAsGuest(roomUuid, 'Guest Priya', H.DESKTOP, 'test-dev-priya-0001'); people.push(g)
    expect(g.body.lobby, JSON.stringify(g.body)).toBe(true)
    await expect(g.page).toHaveURL(/\/wait\/[0-9a-f]{32}$/)
    await expect(headOf(g)).toHaveText('Waiting to join')
    await expect(rowFor('Guest Priya')).toBeVisible({ timeout: 10000 })
    await expect(host.page.locator('#wr-pill')).toHaveText(/1 waiting/)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(1)          // not in the meeting yet
    await rowFor('Guest Priya').locator('.wr-admit').click()
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(g.page, 'Guest Priya')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test('waiting people see nothing of each other; the host can message them and turn one away', async () => {
    const a = await H.openAsGuest(roomUuid, 'Guest Asha'), b = await H.openAsGuest(roomUuid, 'Guest Bilal'); people.push(a, b)
    await expect(rowFor('Guest Asha')).toBeVisible({ timeout: 10000 }); await expect(rowFor('Guest Bilal')).toBeVisible()
    const poll = await a.page.evaluate(() => fetch('/api/waiting/' + location.pathname.split('/').pop()).then(r => r.json()))
    expect(JSON.stringify(poll)).not.toContain('Bilal')
    expect(Object.keys(poll).sort()).toEqual(['host', 'message', 'name', 'status', 'title'])
    await host.page.locator('#wr-message').click()
    await expect(a.page.locator('#msgText')).toHaveText('We will start in 2 minutes', { timeout: 10000 })
    await expect(b.page.locator('#msgText')).toHaveText('We will start in 2 minutes', { timeout: 10000 })
    await rowFor('Guest Bilal').locator('.wr-deny').click()
    await expect(headOf(b)).toHaveText('Not admitted', { timeout: 10000 })
    await expect(headOf(a)).toHaveText('Waiting to join')
  })

  test('invited staff go straight in; other staff wait', async ({ browser }) => {
    const invited = await H.joinAsStaff(meetingId, INVITED, 'Invited Staff'); people.push(invited)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(ctx, 'other.staff@tenetnetworks.com', 'Other Staff')
    const r = await (await ctx.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/join`, { data: {} })).json()
    await ctx.close()
    expect(r.lobby, JSON.stringify(r)).toBe(true)
    expect(r.url).toMatch(/^\/wait\//)
    await expect(rowFor('Other Staff')).toBeVisible({ timeout: 10000 })
  })

  test('someone let in later does not see files shared before they joined', async () => {
    const up = await host.page.evaluate(id => fetch('/api/meetings/' + id + '/files', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'agenda.txt' }, body: 'agenda' }).then(r => r.status), meetingId)
    expect(up).toBe(200)
    await rowFor('Guest Asha').locator('.wr-admit').click()
    const a = people.find(p => p.name === 'Guest Asha')
    await expect(a.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(a.page, 'Guest Asha')
    const seen = await a.page.evaluate(id => fetch('/api/meetings/' + id + '/files').then(r => r.json()), meetingId)
    expect(seen.files.map(f => f.name)).not.toContain('agenda.txt')
    const hostSees = await host.page.evaluate(id => fetch('/api/meetings/' + id + '/files').then(r => r.json()), meetingId)
    expect(hostSees.files.map(f => f.name)).toContain('agenda.txt')
  })

  test('send back to the waiting room, let in again, then finish', async () => {
    const g = people.find(p => p.name === 'Guest Priya')
    const row = host.page.locator('#wr-box .wr-row[data-identity]', { hasText: 'Guest Priya' })
    await expect(row).toBeVisible({ timeout: 10000 })
    await row.locator('.wr-back').click()
    await expect(g.page).toHaveURL(/\/wait\//, { timeout: 15000 })
    await expect(headOf(g), 'sent back: own wording').toHaveText('Back in the waiting room', { timeout: 10000 })
    await expect(rowFor('Guest Priya').locator('.wr-admit')).toBeVisible({ timeout: 10000 })
    await expect(rowFor('Guest Priya').locator('.wr-tag')).toContainText('Sent back')
    await rowFor('Guest Priya').locator('.wr-admit').click()
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(g.page, 'Guest Priya')
    const row2 = host.page.locator('#wr-box .wr-row[data-identity]', { hasText: 'Guest Priya' })
    await expect(row2).toBeVisible({ timeout: 15000 })
    await row2.locator('.wr-finish').click()
    await expect(g.page.locator('#wr-finished')).toContainText('Thank you', { timeout: 15000 })
    const again = await g.page.request.post(`${H.BASE_URL}/api/guest-join/${roomUuid}`, { data: { display_name: 'Guest Priya', device_id: 'test-dev-priya-0001' } })
    expect(again.status(), 'finished: the same device cannot come back').toBe(403)
  })

  test('turning the waiting room off lets everyone waiting in', async () => {
    const c = await H.openAsGuest(roomUuid, 'Guest Chen'); people.push(c)
    await expect(rowFor('Guest Chen')).toBeVisible({ timeout: 10000 })
    await H.openHostSettings(host.page)
    await host.page.locator('#wr-switch').uncheck()
    await expect(c.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    const d = await H.openAsGuest(roomUuid, 'Guest Dev'); people.push(d)
    expect(d.body.lobby, 'no waiting once it is off').toBeFalsy()
    await H.expectHealthy(host)
  })
})
