// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  73 - Resilience: permission denial and reconnection mid-action.

  4. Permission denial: when the browser blocks camera/mic, the user still
     reaches the meeting (camera-off / audio-only or no-media as the case may
     be); nothing hangs or crashes.
  5. Reconnection: a brief network drop during an in-meeting action leaves
     the room in a consistent state afterwards; LiveKit reconnects and user
     actions keep working.
*/

async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

test.describe('73 - resilience', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'rs73')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('join page loads without error when camera/mic permissions are denied', async ({ browser }) => {
    // Launch a fresh context with NO camera/mic permission granted.
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: [] })
    const page = await ctx.newPage()
    const errors = []
    page.on('pageerror', e => errors.push(e.message))

    await page.goto(`${h.BASE_URL}/join/${roomUuid}`, { waitUntil: 'domcontentloaded' })

    // Join page UI should render (name input visible) — no crash, no blank screen
    await expect(page.locator('#n')).toBeVisible({ timeout: 15000 })

    // No unhandled JS errors from the page
    expect(errors).toEqual([])

    await ctx.close()
  })

  test('network drop for 4s: room reconnects and a chat send afterwards still works', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Resilience')
    try {
      await host.page.waitForTimeout(3000)

      // Guest records incoming public chat messages
      await guest.page.evaluate(() => {
        window.__afterReconnect = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg && msg.type === 'chat') window.__afterReconnect.push(msg.text)
          } catch (e) {}
        })
      })

      await openChatPanel(host.page)

      // 1. Verify chat flows before the drop
      await host.page.fill('#chat-input', 'before drop')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2500)
      let got = await guest.page.evaluate(() => window.__afterReconnect)
      expect(got).toContain('before drop')

      // 2. Drop the host's network for 4 seconds
      await host.page.context().setOffline(true)
      await host.page.waitForTimeout(4000)
      await host.page.context().setOffline(false)

      // 3. Give LiveKit up to 20s to reconnect
      await host.page.waitForFunction(
        () => window.__tenetRoom && window.__tenetRoom.state === 'connected',
        null,
        { timeout: 20000 }
      )

      // 4. Verify chat send AFTER reconnect works
      await host.page.waitForTimeout(1500)
      await host.page.fill('#chat-input', 'after drop')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(3000)

      got = await guest.page.evaluate(() => window.__afterReconnect)
      expect(got).toContain('after drop')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })
})
