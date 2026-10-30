// 17 - Chat and names are safe and work: unread dot on "People & Chat", chat messages and guest names shown as
// text (never run as HTML/script), a name with an apostrophe still has a working participant menu.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api
let host, guest, odd

const panelHidden = page => page.evaluate(() => document.getElementById('right-panel').classList.contains('hidden'))
async function setPanel (page, open) {
  if ((await panelHidden(page)) === open) { await page.locator('#btn-panel').click(); await page.waitForTimeout(400) }
  expect(await panelHidden(page)).toBe(!open)
}
async function guestSays (who, text) {
  await H.openPanel(who.page)
  await who.page.fill('#chat-input', text)
  await who.page.press('#chat-input', 'Enter')
}

test.describe.serial('17 - Chat and name safety', () => {

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'chat-safety'))
    host  = await H.joinAsHost(meetingId)
    guest = await H.joinAsGuest(roomUuid, 'Guest Chat')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    await host.page.evaluate(() => { window.__pwned = 0 })
  })

  test.afterEach(async () => { await H.expectHealthy(host, guest, odd) })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [guest, odd, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('unread dot appears while the panel is closed and clears when it is opened', async () => {
    await setPanel(host.page, false)
    await expect(host.page.locator('#chat-badge')).toBeHidden()
    await guestSays(guest, 'Are you there?')
    await expect(host.page.locator('#chat-badge')).toBeVisible({ timeout: 15000 })
    await setPanel(host.page, true)
    await expect(host.page.locator('#chat-badge')).toBeHidden({ timeout: 5000 })
    await expect(host.page.locator('#chat-messages')).toContainText('Are you there?')
  })

  test('chat messages are shown as text, never run as HTML or script', async () => {
    await guestSays(guest, '<img src=x onerror="window.__pwned=1"> <b>bold</b>')
    await expect(host.page.locator('#chat-messages .chat-msg').last()).toContainText('<b>bold</b>', { timeout: 15000 })
    await host.page.waitForTimeout(500)
    const r = await host.page.evaluate(() => ({
      pwned: window.__pwned,
      injected: document.querySelectorAll('#chat-messages img, #chat-messages b, #chat-messages script').length,
    }))
    expect(r.injected, 'HTML elements created from a chat message').toBe(0)
    expect(r.pwned, 'script from a chat message ran').toBe(0)
  })

  test('guest names are cleaned: no HTML, apostrophe kept, participant menu still works', async () => {
    odd = await H.joinAsGuest(roomUuid, "<i>Evil</i> O'Brien")
    await H.openPanel(host.page)
    const row = host.page.locator('.participant-item').filter({ hasText: 'Brien' })
    await expect(row).toHaveCount(1, { timeout: 30000 })
    const r = await host.page.evaluate(() => ({
      italics: document.querySelectorAll('#participants-list i, #video-grid .tile-label i').length,
      pwned: window.__pwned,
    }))
    expect(r.italics, 'HTML from a guest name').toBe(0)
    expect(r.pwned).toBe(0)
    await expect(row).toContainText('O’Brien')                                  // apostrophe kept (as ’)
    expect(await row.locator('.p-name, .tp-name').first().innerText().catch(() => (row.innerText())), 'no < or > in the shown name').not.toMatch(/[<>]/)
    await H.openRowMenu(row)
    await expect(row.locator('button').first()).toBeVisible({ timeout: 5000 })   // menu opens: name did not break it
  })
})
