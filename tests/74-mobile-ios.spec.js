// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  74 - Mobile Safari / iOS smoke: core meeting UI must still work under a
  WebKit + iPhone device profile, and nothing should break when the device
  rotates mid-meeting.
*/

async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

test.describe('74 - mobile iOS smoke', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    if (!(await h.engineAvailable('webkit'))) test.skip(true, 'webkit not installed')
    const m = await h.createMeeting(browser, 'ios74')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('iPhone + WebKit: host joins, core UI visible, no page errors', async () => {
    if (!(await h.engineAvailable('webkit'))) test.skip(true, 'webkit not installed')
    const host = await h.joinAsHost(meetingId, h.IPHONE, 'webkit')
    try {
      // Core toolbar + panel-toggle must render
      await expect(host.page.locator('#btn-mic')).toBeVisible({ timeout: 10000 })
      await expect(host.page.locator('#btn-panel')).toBeVisible({ timeout: 10000 })

      // Panel opens (people/chat drawer on mobile)
      await h.openPanel(host.page)
      await expect(host.page.locator('#right-panel')).toBeVisible()

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('iPhone + WebKit: public chat send works', async () => {
    if (!(await h.engineAvailable('webkit'))) test.skip(true, 'webkit not installed')
    const host = await h.joinAsHost(meetingId, h.IPHONE, 'webkit')
    const guest = await h.joinAsGuest(roomUuid, 'iOS Guest', h.IPHONE, 'webkit')
    try {
      await host.page.waitForTimeout(3000)

      await guest.page.evaluate(() => {
        window.__iosMsgs = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg && msg.type === 'chat') window.__iosMsgs.push(msg.text)
          } catch (e) {}
        })
      })

      await openChatPanel(host.page)
      await host.page.fill('#chat-input', 'hello from iOS')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2500)

      const got = await guest.page.evaluate(() => window.__iosMsgs)
      expect(got).toContain('hello from iOS')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('iPhone + WebKit: orientation change mid-meeting does not break UI', async () => {
    if (!(await h.engineAvailable('webkit'))) test.skip(true, 'webkit not installed')
    const host = await h.joinAsHost(meetingId, h.IPHONE, 'webkit')
    try {
      await expect(host.page.locator('#btn-mic')).toBeVisible({ timeout: 10000 })

      // Capture portrait size (whatever h.IPHONE set)
      const portrait = host.page.viewportSize()
      expect(portrait).not.toBeNull()

      // Flip to landscape: swap width/height
      await host.page.setViewportSize({ width: portrait.height, height: portrait.width })
      await host.page.waitForTimeout(800)

      // Core UI still present after rotation
      await expect(host.page.locator('#btn-mic')).toBeVisible()
      await expect(host.page.locator('#btn-panel')).toBeVisible()

      // No sideways scrolling
      const overflow = await host.page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth
      }))
      expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1)

      // Flip back to portrait
      await host.page.setViewportSize({ width: portrait.width, height: portrait.height })
      await host.page.waitForTimeout(800)
      await expect(host.page.locator('#btn-mic')).toBeVisible()

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })
})
