// 44 - Tenet's own dialogs (6 Nov, item 4a: dialog.js). Turn away, waiting-room Message, Finish, Remove and End
// meeting use our dialog instead of the browser's box: Cancel / Escape does nothing, the main button does exactly
// what the browser box did. Every other test keeps the browser's boxes (window.__tenetNativeDialogs, set in newCtx).
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

const WAITING = /^(Waiting to join|Waiting for the host to let you in)$/
let m, host
const people = []
const dlg = () => host.page.locator('#td-dialog')
const waitRow = name => host.page.locator('#wr-box .wr-row[data-wid]', { hasText: name })
const inRow = name => host.page.locator('#wr-box .wr-row[data-identity]', { hasText: name })
const head = g => g.page.locator('#head')
async function ours (p) {                              // this page uses Tenet's dialogs, now and after any reload
  await p.context().addInitScript(() => { window.__tenetNativeDialogs = false })
  await p.evaluate(() => { window.__tenetNativeDialogs = false })
}
async function guest (name) {
  const g = await H.openAsGuest(m.roomUuid, name); people.push(g)
  await expect(head(g)).toHaveText(WAITING, { timeout: 10000 })
  await expect(waitRow(name)).toBeVisible({ timeout: 10000 })
  return g
}

test.describe.serial('44 - Tenet dialogs', () => {
  test.setTimeout(180000)
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'dialogs')
    const r = await m.api.request.patch(`${H.BASE_URL}/api/meetings/${m.meetingId}`, { data: { waiting_room: 1 } })
    expect(r.status()).toBeLessThan(300)
    host = await H.joinAsHost(m.meetingId)
    await ours(host.page)
    host.page.on('dialog', d => { throw new Error('browser box appeared: ' + d.message()) })
    await H.openPanel(host.page); await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [...people, host]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('Turn away: our dialog; Escape keeps them waiting, Turn away sends "Not admitted"', async () => {
    const g = await guest('Guest Dia')
    await waitRow('Guest Dia').locator('.wr-deny').click()
    await expect(dlg()).toBeVisible()
    await expect(dlg().locator('h2')).toHaveText('Turn Guest Dia away?')
    await expect(host.page.locator('#td-ok')).toHaveText('Turn away')
    await expect(host.page.locator('#td-ok')).toHaveClass(/td-danger/)
    await host.page.keyboard.press('Escape')
    await expect(dlg()).toHaveCount(0)
    await host.page.waitForTimeout(3500)                                     // a full waiting-page poll
    await expect(head(g), 'cancel did nothing').toHaveText(WAITING)
    await waitRow('Guest Dia').locator('.wr-deny').click()
    await host.page.locator('#td-ok').click()
    await expect(head(g)).toHaveText('Not admitted', { timeout: 10000 })
  })

  test('Message: a text box; Enter sends it to everyone waiting', async () => {
    const g = await guest('Guest Eli')
    await host.page.locator('#wr-message').click()
    await expect(dlg().locator('h2')).toHaveText('Message the waiting room')
    const box = host.page.locator('#td-input')
    await expect(box).toBeFocused()
    await expect(host.page.locator('#td-ok')).toHaveText('Remove message')       // empty box
    await box.fill('Starting in two minutes')
    await expect(host.page.locator('#td-ok')).toHaveText('Send')
    await host.page.keyboard.press('Enter')
    await expect(dlg()).toHaveCount(0)
    await expect(g.page.locator('#msgText')).toHaveText('Starting in two minutes', { timeout: 10000 })
  })

  test('Finish: Cancel keeps them in; Finish thanks them', async () => {
    const g = people.find(p => p.name === 'Guest Eli')
    await waitRow('Guest Eli').locator('.wr-admit').click()
    await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await H.finishJoin(g.page, 'Guest Eli')
    await expect(inRow('Guest Eli')).toBeVisible({ timeout: 15000 })
    await inRow('Guest Eli').locator('.wr-finish').click()
    await expect(dlg().locator('h2')).toHaveText('Finish with Guest Eli?')
    await host.page.locator('#td-cancel').click()
    await expect(dlg()).toHaveCount(0)
    await expect(g.page.locator('#wr-finished')).toHaveCount(0)
    await inRow('Guest Eli').locator('.wr-finish').click()
    await host.page.locator('#td-ok').click()
    await expect(g.page.locator('#wr-finished')).toContainText('Thank you', { timeout: 15000 })
  })

  test('Remove: our dialog (red); Cancel keeps them, Remove removes them', async () => {
    await H.openHostSettings(host.page)
    await host.page.locator('#wr-switch').uncheck()                            // let the next guest straight in
    await host.page.keyboard.press('Escape').catch(() => {})
    const g = await H.joinAsGuest(m.roomUuid, 'Guest Fern'); people.push(g)
    const tiles = host.page.locator('#video-grid .video-tile')
    await expect(tiles).toHaveCount(2, { timeout: 30000 })
    const row = host.page.locator('#participants-list > *', { hasText: 'Guest Fern' }).first()
    await expect(row).toBeVisible({ timeout: 15000 })
    const kick = async () => {
      let k = row.locator('.kick-btn')
      if (!(await k.isVisible().catch(() => false))) { await H.openRowMenu(row); k = host.page.locator('.kick-btn').locator('visible=true').first() }
      await k.click()
    }
    await kick()
    await expect(dlg().locator('h2')).toHaveText(/^Remove (Guest Fern|this person)\?$/)
    await expect(host.page.locator('#td-ok')).toHaveClass(/td-danger/)
    await host.page.locator('#td-cancel').click()
    await host.page.waitForTimeout(1500)
    await expect(tiles, 'cancel did nothing').toHaveCount(2)
    await kick()
    await host.page.locator('#td-ok').click()
    await expect(tiles).toHaveCount(1, { timeout: 20000 })
  })

  test('End meeting: our dialog; Escape keeps it running, End meeting ends it for everyone', async () => {
    const g = await H.joinAsGuest(m.roomUuid, 'Guest Gil'); people.push(g)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    const end = async () => { await host.page.locator('#btn-end').click(); await host.page.locator('#btn-end-meeting').click() }
    await end()
    await expect(dlg().locator('h2')).toHaveText('End the meeting for everyone?')
    await expect(host.page.locator('#td-ok')).toHaveText('End meeting')
    await host.page.keyboard.press('Escape')
    await expect(dlg()).toHaveCount(0)
    expect((await H.meetingStatus(m.api, m.meetingId)).status, 'still running').toBe('active')
    await end()
    await host.page.locator('#td-ok').click()
    await expect.poll(async () => (await H.meetingStatus(m.api, m.meetingId)).status, { timeout: 15000 }).toBe('ended')
    await expect(g.page.locator('body')).toContainText(/Meeting ended/i, { timeout: 15000 })
  })
})
