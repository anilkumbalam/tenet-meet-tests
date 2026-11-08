// 42 - Waiting room, whole sequences (6 Nov, after the Finish bug of 5 Nov: let in -> send back -> Finish did nothing
// and the guest's page kept waiting). Each sequence checks, at every step, the guest's screen, the host's waiting card
// (lists, buttons, "N waiting" pill) and the server's record. Rule: every final state must reach the guest's screen.
// The automatic co-host (can only let in) is covered by test 30; a co-host the host chose is test 13 here.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

const WAITING = /^(Waiting to join|Waiting for the host to let you in)$/
const BACK = /^(Back in|Returned to) the waiting room$/
const RUN = Date.now().toString(36)
const dev = name => ('t42-' + name.replace(/[^A-Za-z0-9]/g, '') + '-' + RUN).slice(0, 64)

let meetingId, roomUuid, api, host
const people = []
const head = g => g.page.locator('#head')
const waitRow = name => host.page.locator('#wr-box .wr-row[data-wid]', { hasText: name })
const inRow = name => host.page.locator('#wr-box .wr-row[data-identity]', { hasText: name })
const keyOf = g => (g.page.url().match(/\/wait\/([0-9a-f]{32})/) || [])[1]

async function guest (name) {                      // opens the join link; lands on the waiting page
  const g = await H.openAsGuest(roomUuid, name, H.DESKTOP, dev(name)); people.push(g)
  expect(g.body.lobby, name + ' waits').toBe(true)
  await expect(g.page).toHaveURL(/\/wait\/[0-9a-f]{32}$/)
  await expect(head(g)).toHaveText(WAITING, { timeout: 10000 })
  await expect(waitRow(name)).toBeVisible({ timeout: 10000 })
  return g
}
async function record (g) {                        // what the server tells the waiting page
  const k = keyOf(g); expect(k, 'on a waiting page').toBeTruthy()
  return host.page.evaluate(k => fetch('/api/waiting/' + k).then(r => r.json()), k)
}
async function card () {                           // what the server tells the host's waiting card
  return host.page.evaluate(id => fetch('/api/meetings/' + id + '/waiting').then(r => r.json()), meetingId)
}
async function expectCard ({ waiting = [], admitted = [], absent = [] }) {
  await expect.poll(async () => {
    const c = await card()
    const w = c.waiting.map(x => x.name), a = c.admitted.map(x => x.name)
    return waiting.every(n => w.includes(n)) && admitted.every(n => a.includes(n)) && absent.every(n => !w.includes(n) && !a.includes(n)) &&
      waiting.every(n => !a.includes(n)) && admitted.every(n => !w.includes(n))
  }, { message: 'host card (server): ' + JSON.stringify({ waiting, admitted, absent }), timeout: 10000 }).toBe(true)
  for (const n of waiting) { await expect(waitRow(n)).toHaveCount(1, { timeout: 10000 }); await expect(inRow(n)).toHaveCount(0) }
  for (const n of admitted) { await expect(inRow(n)).toHaveCount(1, { timeout: 10000 }); await expect(waitRow(n)).toHaveCount(0) }
  for (const n of absent) { await expect(waitRow(n)).toHaveCount(0, { timeout: 10000 }); await expect(inRow(n)).toHaveCount(0) }
}
async function letIn (g) {
  await waitRow(g.name).locator('.wr-admit').click()
  await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
  await H.finishJoin(g.page, g.name)
  await expectCard({ admitted: [g.name] })
}
async function sendBack (g) {
  const r = inRow(g.name); await expect(r).toBeVisible({ timeout: 15000 })
  const identity = await r.getAttribute('data-identity')
  await r.locator('.wr-back').click()
  await expect(inRow(g.name), 'card drops them at once').toHaveCount(0, { timeout: 2500 })
  await expect(g.page).toHaveURL(/\/wait\//, { timeout: 15000 })
  await expect(head(g)).toHaveText(BACK, { timeout: 10000 })
  await expectCard({ waiting: [g.name] })
  await expect(waitRow(g.name).locator('.wr-tag')).toContainText('Sent back')
  expect((await record(g)).back, 'server: sent back').toBe(true)
  return identity
}
async function turnAway (g) {
  await waitRow(g.name).locator('.wr-deny').click()
  await expectCard({ absent: [g.name] })
}
async function deviceRefused (g) {
  const again = await g.page.request.post(`${H.BASE_URL}/api/guest-join/${roomUuid}`, { data: { display_name: g.name, device_id: dev(g.name) } })
  expect(again.status(), g.name + ': finished device cannot come back').toBe(403)
}
async function pill (n) {
  if (n) await expect(host.page.locator('#wr-pill')).toHaveText(new RegExp('^' + n + ' waiting'), { timeout: 10000 })
  else await expect(host.page.locator('#wr-pill')).not.toHaveClass(/\bon\b/, { timeout: 10000 })
}

test.describe.serial('42 - Waiting room flows', () => {
  test.setTimeout(240000)
  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'wr-flows'))
    const r = await api.request.patch(`${H.BASE_URL}/api/meetings/${meetingId}`, { data: { waiting_room: 1 } })
    expect(r.status()).toBeLessThan(300)
    host = await H.joinAsHost(meetingId)
    host.page.on('dialog', d => d.accept())
    await H.openPanel(host.page); await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
    await expect(host.page.locator('#wr-switch')).toBeChecked({ timeout: 15000 })
  })
  test.afterAll(async () => {
    if (api) { await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {}); await api.close().catch(() => {}) }
    for (const p of [...people, host]) if (p) await p.browser.close().catch(() => {})
  })

  test('1 wait -> let in', async () => {
    const g = await guest('Guest Anu')
    await pill(1)
    expect((await record(g)).status).toBe('waiting')
    await letIn(g)
    await pill(0)
  })

  test('2 wait -> turn away, with and without a message', async () => {
    const a = await guest('Guest Bala'), b = await guest('Guest Chitra')
    await pill(2)
    await turnAway(a)
    await expect(head(a)).toHaveText('Not admitted', { timeout: 10000 })
    const wid = await waitRow('Guest Chitra').getAttribute('data-wid')
    const st = await host.page.evaluate(([id, wid]) => fetch('/api/meetings/' + id + '/waiting/deny', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [Number(wid)], message: 'Please book another slot' }) }).then(r => r.status), [meetingId, wid])
    expect(st).toBe(200)
    await expect(head(b)).toHaveText('Not admitted', { timeout: 10000 })
    const rb = await record(b); expect(rb.status).toBe('denied'); expect(rb.message).toBe('Please book another slot')
    await expectCard({ absent: ['Guest Chitra'] })
    await pill(0)
  })

  test('3 wait -> the guest leaves', async () => {
    const g = await guest('Guest Dinesh')
    await g.page.locator('#leave').click()
    await expect(head(g)).toHaveText(/^You left/, { timeout: 10000 })
    expect((await record(g)).status).toBe('left')
    await expectCard({ absent: ['Guest Dinesh'] })
  })

  test('4 let in -> send back: listed under Waiting only, tagged', async () => {
    const g = await guest('Guest Esha')
    await letIn(g)
    await sendBack(g)
    await pill(1)
  })

  test('5 send back -> let in again', async () => {
    const g = people.find(p => p.name === 'Guest Esha')
    await letIn(g)
    await pill(0)
  })

  test('6 send back -> turn away: "Thank you for joining"', async () => {
    const g = people.find(p => p.name === 'Guest Esha')
    await sendBack(g)
    await turnAway(g)
    await expect(head(g)).toHaveText('Thank you for joining', { timeout: 10000 })
    await expect(g.page.locator('#status')).toContainText('ended your part in this meeting')
  })

  test('7 let in -> Finish: thank-you, device refused', async () => {
    const g = await guest('Guest Farid')
    await letIn(g)
    await inRow('Guest Farid').locator('.wr-finish').click()
    await expect(g.page.locator('#wr-finished')).toContainText('Thank you', { timeout: 15000 })
    await expectCard({ absent: ['Guest Farid'] })
    await deviceRefused(g)
  })

  test('8 send back -> Finish (the 5 Nov bug): the waiting page shows the thank-you', async () => {
    const g = await guest('Guest Gita')
    await letIn(g)
    const identity = await sendBack(g)
    // The card no longer offers Finish once someone is back in the waiting room; a page that still showed it
    // (as on 5 Nov) sends exactly this request.
    const r = await host.page.evaluate(([id, who]) => fetch('/api/meetings/' + id + '/finish/' + encodeURIComponent(who), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(async r => ({ s: r.status, b: await r.json() })), [meetingId, identity])
    expect(r.s, JSON.stringify(r.b)).toBe(200)
    await expect(head(g)).toHaveText('Thank you for joining', { timeout: 10000 })
    const rec = await record(g); expect(rec.status).toBe('denied'); expect(rec.finished).toBe(true)
    await expectCard({ absent: ['Guest Gita'] })
    await deviceRefused(g)
  })

  test('8b a failed action tells the host (and nothing changes)', async () => {
    const g = await guest('Guest Kiran')
    await letIn(g)
    await host.page.route('**/finish/**', r => r.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: 'Not in the meeting' }) }))
    await inRow('Guest Kiran').locator('.wr-finish').click()
    await expect(host.page.getByText(/Couldn.t finish with Guest Kiran: Not in the meeting/)).toBeVisible({ timeout: 5000 })
    await expect(inRow('Guest Kiran').locator('.wr-finish')).toBeEnabled({ timeout: 5000 })
    await host.page.unroute('**/finish/**')
    await expectCard({ admitted: ['Guest Kiran'] })
    await inRow('Guest Kiran').locator('.wr-finish').click()
    await expect(g.page.locator('#wr-finished')).toContainText('Thank you', { timeout: 15000 })
  })

  test('9 two waiting, act on one: the other keeps waiting', async () => {
    const a = await guest('Guest Hari'), b = await guest('Guest Indu')
    await pill(2)
    await letIn(a)
    await expect(head(b)).toHaveText(WAITING)
    await expectCard({ waiting: ['Guest Indu'], admitted: ['Guest Hari'] })
    await pill(1)
    await turnAway(b)
    await expect(head(b)).toHaveText('Not admitted', { timeout: 10000 })
    await expect(a.page, 'the one let in stays in').toHaveURL(/\/meeting\//)
  })

  test('10 reload after send back keeps the place', async () => {
    const g = people.find(p => p.name === 'Guest Hari')
    await sendBack(g)
    const url = g.page.url()
    await g.page.reload()
    await expect(head(g)).toHaveText(BACK, { timeout: 10000 })
    expect(g.page.url()).toBe(url)
    await expectCard({ waiting: ['Guest Hari'] })
  })

  test('11 waiting room switched off lets in someone sent back', async () => {
    const g = people.find(p => p.name === 'Guest Hari')
    await H.openHostSettings(host.page)
    await host.page.locator('#wr-switch').uncheck()
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(g.page, g.name)
    await host.page.locator('#wr-switch').check()
    await expect(host.page.locator('#wr-switch')).toBeChecked({ timeout: 10000 })
    await host.page.keyboard.press('Escape').catch(() => {})
  })

  test('13 a co-host the host chose: let in, send back, let in again, Finish, turn away, Finish after send back', async () => {
    const CO = 'wr42.cohost@tenetnetworks.com'
    const r = await api.request.patch(`${H.BASE_URL}/api/meetings/${meetingId}`, { data: { invited_emails: CO } })
    expect(r.status()).toBeLessThan(300)
    const co = await H.joinAsStaff(meetingId, CO, 'Chosen Cohost'); people.push(co)
    co.page.on('dialog', d => d.accept())
    const row = host.page.locator('#participants-list > *', { hasText: 'Chosen Cohost' }).first()
    await expect(row).toBeVisible({ timeout: 30000 })
    let make = row.locator('.p-mod-btn', { hasText: 'Make co-host' })
    if (!(await make.isVisible().catch(() => false))) { await H.openRowMenu(row); make = host.page.locator('.p-mod-btn', { hasText: 'Make co-host' }).locator('visible=true').first() }
    await make.click()
    await expect.poll(async () => { const s = await H.meetingStatus(api, meetingId); return [s.moderator_email, Boolean(s.moderator_auto)] }, { timeout: 30000 }).toEqual([CO, false])
    await H.openPanel(co.page); await co.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
    await expect.poll(() => co.page.evaluate(() => { const s = window.TenetWaiting && window.TenetWaiting.state(); return Boolean(s && s.manage && s.canFinish) }), { message: 'chosen co-host runs the waiting room, Finish included', timeout: 30000 }).toBe(true)
    const realHost = host; host = co                    // the same steps, done by the co-host
    try {
      const g = await guest('Guest Lata')
      await letIn(g)
      await sendBack(g)
      await letIn(g)
      await inRow('Guest Lata').locator('.wr-finish').click()
      await expect(g.page.locator('#wr-finished')).toContainText('Thank you', { timeout: 15000 })
      await deviceRefused(g)
      const m = await guest('Guest Mohan')
      await turnAway(m)
      await expect(head(m)).toHaveText('Not admitted', { timeout: 10000 })
      const n = await guest('Guest Nila')
      await letIn(n)
      const identity = await sendBack(n)
      const f = await co.page.evaluate(([id, who]) => fetch('/api/meetings/' + id + '/finish/' + encodeURIComponent(who), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' }).then(r => r.status), [meetingId, identity])
      expect(f, 'co-host: Finish after send back').toBe(200)
      await expect(head(n)).toHaveText('Thank you for joining', { timeout: 10000 })
    } finally { host = realHost }
  })

  test('12 meeting ends while waiting and while sent back: "Meeting ended"', async () => {
    const w = await guest('Guest Jaya')
    const b = people.find(p => p.name === 'Guest Hari')
    await sendBack(b)
    const st = await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`)
    expect(st.status()).toBeLessThan(300)
    await expect(head(w)).toHaveText('Meeting ended', { timeout: 10000 })
    await expect(head(b)).toHaveText('Meeting ended', { timeout: 10000 })
  })
})
