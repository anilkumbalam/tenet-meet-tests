// 46 - Locked indicator (item 6, 6 Nov): lock-v4.js.
//  - Host locks: the host's Lock button turns orange "Locked"; the guest sees the "Locked" pill and a notice within seconds.
//  - The host reloads: button and pill still say Locked (taken from the server, not from memory).
//  - Host unlocks: the pill goes for everyone, the button is back to "Lock".
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host, guest

const pill = page => page.locator('#lk-pill')
const btn = page => page.evaluate(() => { const b = document.getElementById('btn-lock'); return b ? (b.classList.contains('lk-on') ? 'on' : 'off') + ' ' + (b.dataset.locked || '') + ' ' + b.textContent.trim() : 'none' })
const serverLocked = async () => (await H.meetingStatus(api, meetingId)).lock_room
const noticeText = page => page.evaluate(() => (document.getElementById('notif-area') || {}).textContent || '')

test.describe.serial('46 - Locked indicator', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'lock-test'))
    host = await H.joinAsHost(meetingId)
    guest = await H.joinAsGuest(roomUuid, 'Guest Lock')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('unlocked: no pill for anyone, the button says Lock', async () => {
    await expect(pill(host.page)).toBeHidden()
    await expect(pill(guest.page)).toBeHidden()
    expect(await btn(host.page)).toMatch(/^off .*Lock$/)
  })

  test('host locks: orange "Locked" button; the guest sees the pill and a notice', async () => {
    await host.page.locator('#btn-lock').click()
    await expect.poll(serverLocked, { timeout: 10000 }).toBe(true)
    await expect.poll(() => btn(host.page), { timeout: 5000 }).toMatch(/^on true .*Locked$/)
    await expect(pill(host.page)).toBeVisible()
    await expect(pill(guest.page)).toBeVisible({ timeout: 10000 })
    await expect.poll(() => noticeText(guest.page), { timeout: 5000 }).toContain("Meeting locked. New people can't join.")
    await expect(guest.page.locator('#btn-lock')).toBeHidden()                     // guests have no Lock button
  })

  test('the host reloads: still Locked after the reload, and Lock now unlocks', async () => {
    await host.page.reload({ waitUntil: 'domcontentloaded' })
    await H.finishJoin(host.page, 'Host reload')
    await expect.poll(() => H.roomState(host.page), { timeout: 30000 }).toBe('connected')
    await expect.poll(() => btn(host.page), { timeout: 30000 }).toMatch(/^on true .*Locked$/)
    await expect(pill(host.page)).toBeVisible()
  })

  test('host unlocks: the pill goes for everyone, the button says Lock', async () => {
    await host.page.locator('#btn-lock').click()
    await expect.poll(serverLocked, { timeout: 10000 }).toBe(false)
    await expect.poll(() => btn(host.page), { timeout: 5000 }).toMatch(/^off false .*Lock$/)
    await expect(pill(host.page)).toBeHidden()
    await expect(pill(guest.page)).toBeHidden({ timeout: 10000 })
    await expect.poll(() => noticeText(guest.page), { timeout: 5000 }).toContain('Meeting unlocked.')
  })
})
