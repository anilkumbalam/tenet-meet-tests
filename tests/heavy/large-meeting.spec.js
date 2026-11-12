// @ts-check
/*
  Heavy — large-meeting baseline (not in the main run).
  Launches 20 participants and asserts they all see each other. Resource heavy;
  the Playwright host needs ~6 GB free RAM and plenty of CPU. Run manually:

    npx playwright test tests/heavy/large-meeting.spec.js --timeout=600000 --reporter=list
*/
const { test, expect } = require('@playwright/test')
const h = require('../meet-helpers')

const N_GUESTS = 20

test.describe('heavy - large meeting', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'lg')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test(`${N_GUESTS + 1} participants: everyone sees everyone`, async () => {
    test.setTimeout(10 * 60 * 1000)

    const host = await h.joinAsHost(meetingId)
    const guests = []
    try {
      for (let i = 0; i < N_GUESTS; i++) {
        guests.push(await h.joinAsGuest(roomUuid, `LG${String(i + 1).padStart(2, '0')}`))
        if (i % 5 === 4) await host.page.waitForTimeout(1500)   // small breather every 5 joins
      }

      // Give the room time to settle
      await host.page.waitForTimeout(15000)

      // Each page should see everyone — check host and a sample of guests
      const samples = [host.page, guests[0].page, guests[Math.floor(N_GUESTS / 2)].page, guests[N_GUESTS - 1].page]
      for (const page of samples) {
        const count = await page.evaluate(() =>
          window.__tenetRoom ? window.__tenetRoom.remoteParticipants.size + 1 : 0
        )
        expect(count).toBe(N_GUESTS + 1)
      }

      // Host chat reaches at least one guest
      await h.openPanel(host.page)
      await host.page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
      await host.page.waitForSelector('#pc-tabs', { timeout: 8000 })
      await guests[0].page.evaluate(() => {
        window.__lgMsgs = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg && msg.type === 'chat') window.__lgMsgs.push(msg.text)
          } catch (e) {}
        })
      })
      await host.page.fill('#chat-input', 'hello all')
      await host.page.click('#chat-send')
      await guests[0].page.waitForTimeout(3000)
      const got = await guests[0].page.evaluate(() => window.__lgMsgs)
      expect(got).toContain('hello all')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guests[0].page)
    } finally {
      for (const g of guests) { try { await g.browser.close() } catch (e) {} }
      try { await host.browser.close() } catch (e) {}
    }
  })
})
