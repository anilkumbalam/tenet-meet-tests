// @ts-check
/*
  Heavy — concurrent meetings capacity (not in the main run).
  Starts 3 meetings in parallel, each with a host + 9 guests (10 people each,
  30 total). Verifies everyone sees everyone inside their own meeting.
  Different from large-meeting, which packs a single meeting — this stresses
  the server's ability to handle several rooms at once.

  Resource heavy. Playwright host needs ~8 GB free RAM and ample CPU. Run:

    npx playwright test tests/heavy/concurrent-meetings.spec.js --timeout=900000 --reporter=list
*/
const { test, expect } = require('@playwright/test')
const h = require('../meet-helpers')

const N_MEETINGS = 3
const N_GUESTS = 9   // + host = 10 per meeting

test.describe('heavy - concurrent meetings', () => {
  test(`${N_MEETINGS} meetings in parallel, ${N_GUESTS + 1} people each: everyone sees everyone in their meeting`, async ({ browser }) => {
    test.setTimeout(15 * 60 * 1000)

    // Create all meetings up front, each with max_participants raised for the test
    const meetings = []
    for (let i = 0; i < N_MEETINGS; i++) {
      meetings.push(await h.createMeeting(browser, `cm${i + 1}`, { max_participants: 100 }))
    }

    // For each meeting, build a function that joins host + guests and verifies
    const openOne = async (m, idx) => {
      const host = await h.joinAsHost(m.meetingId)
      const guests = []
      try {
        for (let g = 0; g < N_GUESTS; g++) {
          guests.push(await h.joinAsGuest(m.roomUuid, `M${idx + 1}G${String(g + 1).padStart(2, '0')}`))
          if (g % 3 === 2) await host.page.waitForTimeout(1500)   // breather every few joins
        }

        await host.page.waitForTimeout(10000)   // let the room settle

        // Host and a sample guest should each see the correct size
        const samples = [host.page, guests[0].page, guests[N_GUESTS - 1].page]
        for (const page of samples) {
          const count = await page.evaluate(() =>
            window.__tenetRoom ? window.__tenetRoom.remoteParticipants.size + 1 : 0
          )
          expect(count).toBe(N_GUESTS + 1)
        }

        await h.expectHealthy(host.page)
        await h.expectHealthy(guests[0].page)
        return true
      } finally {
        for (const g of guests) { try { await g.browser.close() } catch (e) {} }
        try { await host.browser.close() } catch (e) {}
      }
    }

    try {
      // Run all three meetings in parallel
      const results = await Promise.all(meetings.map((m, i) => openOne(m, i)))
      expect(results).toEqual(Array(N_MEETINGS).fill(true))
    } finally {
      for (const m of meetings) { try { await m.api.close() } catch (e) {} }
    }
  })
})
