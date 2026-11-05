// 36 - v4 side panel (redesign stage 3): People / Chat tabs with an unread dot; Host settings popover (⚙) with the
// waiting-room switch, the Files switch and the co-host rule, for the host only; the waiting card stays hidden while
// nobody is waiting.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test.describe.serial('36 - v4 side panel', () => {
  test.setTimeout(150000)
  let m, host, guest
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'panel-v4')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Panel')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    for (const p of [host.page, guest.page]) await H.openPanel(p)
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('People and Chat are tabs; a new message while on People shows the dot on Chat', async () => {
    const p = host.page
    await expect(p.locator('#right-panel .tp-tab')).toHaveCount(2)
    await p.locator('.tp-tab[data-tab="people"]').click()
    await expect(p.locator('#participants-list')).toBeVisible()
    await expect(p.locator('#chat-input')).toBeHidden()
    await H.showChat(guest.page)
    await guest.page.fill('#chat-input', 'hello from the guest')
    await guest.page.press('#chat-input', 'Enter')
    await expect(p.locator('#tp-dot'), 'unread dot on the Chat tab').toBeVisible({ timeout: 15000 })
    await p.locator('.tp-tab[data-tab="chat"]').click()
    await expect(p.locator('#chat-input')).toBeVisible()
    await expect(p.locator('#chat-messages')).toContainText('hello from the guest')
    await expect(p.locator('#tp-dot')).toBeHidden()
  })

  test('Host settings: host only; holds the three switches; Escape closes it', async () => {
    await expect(host.page.locator('#hs-btn')).toBeVisible({ timeout: 15000 })
    await expect(guest.page.locator('#hs-btn')).toBeHidden()
    await host.page.locator('#hs-btn').click()
    const pop = host.page.locator('#hs-pop')
    await expect(pop).toBeVisible()
    await expect(pop.locator('#wr-switch')).toBeVisible({ timeout: 15000 })
    await expect(pop.locator('#tf-switch')).toBeVisible()
    await expect(pop.locator('#cc-select')).toBeVisible({ timeout: 15000 })
    await expect(host.page.locator('#section-chat .panel-header #tf-switch'), 'not in the chat header any more').toHaveCount(0)
    await host.page.keyboard.press('Escape')
    await expect(pop).toBeHidden()
  })

  test('waiting-room switch in Host settings turns the waiting room on and off', async () => {
    const api = (url) => m.api.request.get(`${H.BASE_URL}/api/meetings/${m.meetingId}/waiting`).then(r => r.json())
    await H.openHostSettings(host.page)
    await host.page.locator('#wr-switch').check()
    await expect.poll(async () => (await api()).enabled, { timeout: 10000 }).toBe(true)
    await expect(host.page.locator('#wr-box'), 'no card while nobody is waiting').toBeHidden()
    await H.openHostSettings(host.page)
    await host.page.locator('#wr-switch').uncheck()
    await expect.poll(async () => (await api()).enabled, { timeout: 10000 }).toBe(false)
    await H.expectHealthy(host, guest)
  })
})
