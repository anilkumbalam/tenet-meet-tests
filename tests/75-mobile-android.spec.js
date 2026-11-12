// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  75 - Mobile Android (Chromium + phone viewport) smoke: core meeting UI must
  still work on an Android Chrome device profile, and nothing should break
  when the device rotates mid-meeting.
*/

async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

test.describe('75 - mobile Android smoke', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'an75')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('Android + Chromium: host joins, core UI visible, no page errors', async () => {
    const host = await h.joinAsHost(meetingId, h.PHONE, 'chromium')
    try {
      await expect(host.page.locator('#btn-mic')).toBeVisible({ timeout: 10000 })
      await expect(host.page.locator('#btn-panel')).toBeVisible({ timeout: 10000 })

      await h.openPanel(host.page)
      await expect(host.page.locator('#right-panel')).toBeVisible()

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('Android + Chromium: public chat send works', async () => {
    const host = await h.joinAsHost(meetingId, h.PHONE, 'chromium')
    const guest = await h.joinAsGuest(roomUuid, 'Android Guest', h.PHONE, 'chromium')
    try {
      await host.page.waitForTimeout(3000)

      await guest.page.evaluate(() => {
        window.__androidMsgs = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg && msg.type === 'chat') window.__androidMsgs.push(msg.text)
          } catch (e) {}
        })
      })

      await openChatPanel(host.page)
      await host.page.fill('#chat-input', 'hello from Android')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2500)

      const got = await guest.page.evaluate(() => window.__androidMsgs)
      expect(got).toContain('hello from Android')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('Android + Chromium: orientation change mid-meeting does not break UI', async () => {
    const host = await h.joinAsHost(meetingId, h.PHONE, 'chromium')
    try {
      await expect(host.page.locator('#btn-mic')).toBeVisible({ timeout: 10000 })

      const portrait = host.page.viewportSize()
      expect(portrait).not.toBeNull()

      // Flip to landscape
      await host.page.setViewportSize({ width: portrait.height, height: portrait.width })
      await host.page.waitForTimeout(800)

      await expect(host.page.locator('#btn-mic')).toBeVisible()
      await expect(host.page.locator('#btn-panel')).toBeVisible()

      const overflow = await host.page.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        cw: document.documentElement.clientWidth
      }))
      expect(overflow.sw).toBeLessThanOrEqual(overflow.cw + 1)

      // Flip back
      await host.page.setViewportSize({ width: portrait.width, height: portrait.height })
      await host.page.waitForTimeout(800)
      await expect(host.page.locator('#btn-mic')).toBeVisible()

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })
})
