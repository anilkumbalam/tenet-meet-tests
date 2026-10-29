// 14 - Staying in the meeting: screen wake lock, "Connection lost" + Rejoin, and host / co-host roles
// when the host has two tabs, reloads (automatic vs delegated co-host), or really leaves.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api
let hostA, hostB, guest

const wake = page => page.evaluate(() => Boolean(window.TenetWakeLock && window.TenetWakeLock.active()))
const moderator = async () => { const s = await H.meetingStatus(api, meetingId); return s.moderator_email || s.moderator_pid || null }

test.describe.serial('14 - Connection and roles', () => {

  test.setTimeout(300000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'conn-test'))
    hostA = await H.joinAsHost(meetingId)
    guest = await H.joinAsGuest(roomUuid, 'Guest Stay')
    await expect(hostA.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [hostA, hostB, guest]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('wake lock: screen kept awake while in the meeting', async () => {
    await expect.poll(() => wake(hostA.page), { timeout: 15000 }).toBe(true)
    await expect.poll(() => wake(guest.page), { timeout: 15000 }).toBe(true)
  })

  test('host opens a second tab, old tab closes: guest is NOT made co-host', async () => {
    expect(await moderator()).toBeNull()
    hostB = await H.joinAsHost(meetingId)                          // same account -> LiveKit drops tab A
    await expect.poll(() => H.roomState(hostB.page), { timeout: 20000 }).toBe('connected')
    await expect.poll(() => H.roomState(hostA.page), { timeout: 30000 }).toBe('disconnected')
    await expect(hostA.page.locator('#rj-screen')).toHaveCount(0)   // replaced by another tab: no Rejoin offer
    await hostA.page.waitForTimeout(8000)                          // old tab's "leave" + redirect happen
    await hostA.browser.close(); hostA = null
    await guest.page.waitForTimeout(5000)
    expect(await moderator()).toBeNull()
    await expect(guest.page.locator('.participant-item').filter({ hasText: 'Guest Stay' }).locator('.mod-badge', { hasText: 'co-host' })).toHaveCount(0)
  })

  test('connection lost: "Connection lost" + Rejoin (not "You Left"), Rejoin brings the host back', async () => {
    const p = hostB.page
    await hostB.ctx.setOffline(true)
    await expect(p.locator('#rj-screen')).toBeVisible({ timeout: 150000 })
    await expect(p.locator('#rj-screen h2')).toHaveText('Connection lost')
    await expect(p.locator('#ended-screen')).not.toHaveClass(/show/)
    expect(await wake(p)).toBe(false)                              // lock released while disconnected
    await hostB.ctx.setOffline(false)
    await p.waitForTimeout(1500)
    await p.locator('#rj-go').click()
    await H.finishJoin(p, 'Host rejoin')
    await expect.poll(() => H.roomState(p), { timeout: 30000 }).toBe('connected')
    await expect(guest.page.locator('.participant-item').filter({ hasText: 'Anil' })).toHaveCount(1, { timeout: 30000 })
    await expect.poll(() => moderator(), { timeout: 45000 }).toBeNull()   // host role back with the host
    await expect.poll(() => wake(p), { timeout: 15000 }).toBe(true)
  })

  test('host reloads the tab: automatic co-host is handed back to the host', async () => {
    expect(await moderator()).toBeNull()
    await hostB.page.reload({ waitUntil: 'domcontentloaded' })    // reload sends "leave" -> guest promoted (auto)
    await H.finishJoin(hostB.page, 'Host reload')
    await expect.poll(() => H.roomState(hostB.page), { timeout: 30000 }).toBe('connected')
    await expect.poll(() => moderator(), { timeout: 45000 }).toBeNull()   // first heartbeat of the reloaded tab hands it back
  })

  test('delegated co-host stays co-host when the host reloads', async () => {
    const p = hostB.page
    await H.openPanel(p)
    const row = p.locator('.participant-item').filter({ hasText: 'Guest Stay' })
    await H.openRowMenu(row)
    await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).click()
    await expect.poll(() => moderator(), { timeout: 15000 }).not.toBeNull()
    await p.reload({ waitUntil: 'domcontentloaded' })
    await H.finishJoin(p, 'Host reload 2')
    await expect.poll(() => H.roomState(p), { timeout: 30000 }).toBe('connected')
    await p.waitForTimeout(40000)                                  // longer than one heartbeat cycle
    expect(await moderator()).not.toBeNull()                       // still Guest Stay: delegated, not automatic
  })

  test('host really leaves: role is handed to the guest (unchanged behaviour)', async () => {
    await hostB.page.goto('about:blank')                            // tab closes -> leave is sent
    await expect.poll(() => moderator(), { timeout: 30000 }).not.toBeNull()
  })
})
