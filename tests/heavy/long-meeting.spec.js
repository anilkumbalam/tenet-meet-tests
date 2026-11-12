// @ts-check
/*
  Heavy — long-meeting stability (not in the main run).
  Runs a 15-minute meeting with 2 participants doing periodic activity, then
  asserts memory usage didn't balloon. Run manually:

    npx playwright test tests/heavy/long-meeting.spec.js --timeout=1800000 --reporter=list
*/
const { test, expect } = require('@playwright/test')
const h = require('../meet-helpers')

async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

test.describe('heavy - long meeting', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'lm')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('15-minute meeting with periodic chat: connection stable, memory growth bounded', async () => {
    test.setTimeout(20 * 60 * 1000)

    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'LongGuest')
    try {
      await host.page.waitForTimeout(3000)
      await openChatPanel(host.page)

      // Baseline memory (Chromium exposes performance.memory)
      const baselineMem = await host.page.evaluate(() =>
        (performance.memory && performance.memory.usedJSHeapSize) || 0
      )

      // 15 minutes of periodic activity: send chat every 20s (45 messages)
      const DURATION_MS = 15 * 60 * 1000
      const INTERVAL_MS = 20 * 1000
      const start = Date.now()
      let sent = 0

      while (Date.now() - start < DURATION_MS) {
        await host.page.fill('#chat-input', `msg ${sent + 1}`)
        await host.page.click('#chat-send')
        sent++
        await host.page.waitForTimeout(INTERVAL_MS)

        // Every ~minute check the room is still connected
        if (sent % 3 === 0) {
          const state = await host.page.evaluate(() => window.__tenetRoom && window.__tenetRoom.state)
          expect(state).toBe('connected')
        }
      }

      expect(sent).toBeGreaterThanOrEqual(40)

      // Memory check — tolerate 2× growth; anything beyond suggests a leak
      const finalMem = await host.page.evaluate(() =>
        (performance.memory && performance.memory.usedJSHeapSize) || 0
      )
      if (baselineMem > 0) {
        expect(finalMem).toBeLessThan(baselineMem * 3)   // generous — catches gross leaks
      }

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })
})
