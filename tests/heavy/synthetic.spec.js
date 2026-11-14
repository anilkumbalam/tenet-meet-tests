// @ts-check
// Synthetic end-to-end check for Tenet Meet.
// Minimal lifecycle: create → host join → guest join → both see each other → chat → end.
// Run from /root/synthetic-run.sh every 15 min; POSTs result to /api/alerts/synthetic on MEET.
// Lives under tests/heavy/ so it doesn't run in the main full-suite glob (which is tests/*.spec.js).

const { test, expect } = require('@playwright/test')
const h = require('../meet-helpers')

test.describe('synthetic — minimal lifecycle', () => {
  test.setTimeout(90_000)

  test('create → host join → guest join → both see each other → chat → end', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'synth')
    try {
      const host = await h.joinAsHost(m.meetingId)
      try {
        const guest = await h.joinAsGuest(m.roomUuid, 'SyntheticGuest')
        try {
          // Host should see the guest in the LiveKit room (remoteParticipants > 0)
          await expect.poll(async () => {
            return await host.page.evaluate(() => {
              const r = window.__tenetRoom
              if (!r) return -1
              // Both Map and Set-ish shapes exist across SDK versions
              return (r.remoteParticipants && (r.remoteParticipants.size ?? r.remoteParticipants.length)) || 0
            })
          }, { timeout: 15_000, message: 'host never saw the guest in remoteParticipants' }).toBeGreaterThanOrEqual(1)

          // Guest should see the host likewise
          await expect.poll(async () => {
            return await guest.page.evaluate(() => {
              const r = window.__tenetRoom
              if (!r) return -1
              return (r.remoteParticipants && (r.remoteParticipants.size ?? r.remoteParticipants.length)) || 0
            })
          }, { timeout: 15_000, message: 'guest never saw the host in remoteParticipants' }).toBeGreaterThanOrEqual(1)

          // Open the People & Chat panel on both sides so chat input is visible
          // (v4 keeps it collapsed by default). h.showChat is the standard helper.
          if (typeof h.showChat === 'function') {
            await h.showChat(guest.page)
            await h.showChat(host.page)
          } else {
            // Fallback: click the panel toggle and the chat tab
            for (const p of [guest.page, host.page]) {
              await p.locator('#btn-panel').click().catch(() => {})
              await p.locator('#tp-tabs .tp-tab[data-tab="chat"], #tp-chat-tab').first().click({ timeout: 2000 }).catch(() => {})
            }
          }

          // DataChannel chat: guest sends, host receives
          const marker = 'synth-marker-' + Date.now()
          const chatInput = guest.page.locator('#chat-input')
          await chatInput.waitFor({ state: 'visible', timeout: 10_000 })
          await chatInput.fill(marker)
          await chatInput.press('Enter')

          await expect(host.page.locator('#chat-messages')).toContainText(marker, { timeout: 10_000 })
        } finally {
          await guest.browser.close()
        }
      } finally {
        await host.browser.close()
      }

      // Explicitly end + delete so the dashboard stays clean: otherwise the row
      // lingers as 'active' for ~5 min (LiveKit's departure_timeout -> webhook),
      // and global-teardown's title pattern doesn't currently match synth-*.
      // Both calls use m.api (admin context).
      try {
        await m.api.request.post(`${h.BASE_URL}/api/meetings/${m.meetingId}/end`)
      } catch (e) { console.warn('[synthetic] end failed:', e.message) }
      try {
        await m.api.request.delete(`${h.BASE_URL}/api/meetings/${m.meetingId}`)
      } catch (e) { console.warn('[synthetic] delete failed:', e.message) }
    } finally {
      await m.api.close()
    }
  })
})
