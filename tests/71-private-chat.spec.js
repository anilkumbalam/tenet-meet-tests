// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  71 – Private chat
  Tests the one-to-one private messaging system:
  - Module loads and exposes TenetPrivateChat
  - Everyone/Private tabs appear in the chat panel
  - Host can send private message to guest (and vice versa)
  - Regular participant sees message button only on host/co-host
  - Messages are not visible to other participants
  - Unread indicators work
*/

// Open the right panel and switch to the Chat tab, then wait for #pc-tabs
async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

test.describe('71 – private chat', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'pc71')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('module loads and exposes TenetPrivateChat', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      const result = await host.page.evaluate(() => {
        const pc = window.TenetPrivateChat
        return pc ? {
          hasOpenThread: typeof pc.openThread === 'function',
          hasOnPrivateMessage: typeof pc.onPrivateMessage === 'function'
        } : null
      })
      expect(result).not.toBeNull()
      expect(result.hasOpenThread).toBe(true)
      expect(result.hasOnPrivateMessage).toBe(true)
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('Everyone / Private tabs appear in the chat section', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      await openChatPanel(host.page)

      const tabs = await host.page.$$eval('#pc-tabs .pc-tab', els => els.map(e => e.textContent.trim()))
      expect(tabs).toContain('Everyone')
      expect(tabs).toContain('Private')

      // Everyone tab should be active by default
      const activeTab = await host.page.$eval('#pc-tabs .pc-tab.active', el => el.textContent.trim())
      expect(activeTab).toBe('Everyone')

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('switching to Private tab shows thread list, back to Everyone shows public chat', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      await openChatPanel(host.page)

      // Click Private tab
      await host.page.click('#pc-tabs [data-tab="private"]')

      // Thread list should be visible
      const tlVisible = await host.page.$eval('#pc-thread-list', el => el.style.display !== 'none')
      expect(tlVisible).toBe(true)

      // Public chat messages should be hidden
      const chatHidden = await host.page.$eval('#chat-messages', el => el.style.display === 'none')
      expect(chatHidden).toBe(true)

      // Click Everyone tab — public chat comes back
      await host.page.click('#pc-tabs [data-tab="all"]')
      const chatBack = await host.page.$eval('#chat-messages', el => el.style.display !== 'none')
      expect(chatBack).toBe(true)

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('host sees guest in private thread list', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Alpha')
    try {
      await host.page.waitForTimeout(3000)

      await openChatPanel(host.page)
      await host.page.click('#pc-tabs [data-tab="private"]')
      await host.page.waitForTimeout(3000)  // poll interval

      const names = await host.page.$$eval('#pc-thread-list .pc-thread-name',
        els => els.map(e => e.textContent.trim())
      )
      expect(names.some(n => n.includes('Guest Alpha'))).toBe(true)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('host can send a private message to guest, guest receives it', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Beta')
    try {
      await host.page.waitForTimeout(3000)

      // Get guest's identity
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      expect(guestIdentity).toBeTruthy()

      // Set up DataReceived listener on guest side via the room's EventEmitter
      // (LiveKit's RoomEvent.DataReceived === 'dataReceived')
      await guest.page.evaluate(() => {
        if (!window.__tenetRoom) throw new Error('__tenetRoom not available')
        window.__receivedPrivate = []
        window.__tenetRoom.on('dataReceived', (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload))
            if (msg && msg.type === 'private') {
              window.__receivedPrivate.push(msg)
            }
          } catch (e) {}
        })
      })

      // Host opens thread and sends
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'Hello privately')
      await host.page.click('#chat-send')

      // Wait for delivery
      await guest.page.waitForTimeout(3000)

      const received = await guest.page.evaluate(() => window.__receivedPrivate)
      expect(received.length).toBeGreaterThan(0)
      expect(received[0].text).toBe('Hello privately')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('private message not visible to third participant', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest1 = await h.joinAsGuest(roomUuid, 'Guest One')
    const guest2 = await h.joinAsGuest(roomUuid, 'Guest Two')
    try {
      await host.page.waitForTimeout(3000)

      // Set up DataReceived listener on guest 2 (should NOT receive the message)
      await guest2.page.evaluate(() => {
        if (!window.__tenetRoom) throw new Error('__tenetRoom not available')
        window.__receivedPrivate = []
        window.__tenetRoom.on('dataReceived', (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload))
            if (msg && msg.type === 'private') {
              window.__receivedPrivate.push(msg)
            }
          } catch (e) {}
        })
      })

      // Get guest 1's identity
      const guest1Identity = await guest1.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      // Host sends private message to guest 1
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guest1Identity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'Secret for guest one')
      await host.page.click('#chat-send')

      // Wait and check guest 2 did NOT receive it
      await guest2.page.waitForTimeout(3000)
      const guest2Received = await guest2.page.evaluate(() => window.__receivedPrivate)
      expect(guest2Received.length).toBe(0)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest1.page)
      await h.expectHealthy(guest2.page)
    } finally {
      await guest2.browser.close()
      await guest1.browser.close()
      await host.browser.close()
    }
  })

  test('guest can reply to host private message', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Reply')
    try {
      await host.page.waitForTimeout(3000)

      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      const hostIdentity = await host.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      // Set up DataReceived listener on host via the room's EventEmitter
      await host.page.evaluate(() => {
        if (!window.__tenetRoom) throw new Error('__tenetRoom not available')
        window.__hostReceived = []
        window.__tenetRoom.on('dataReceived', (payload) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(payload))
            if (msg && msg.type === 'private') {
              window.__hostReceived.push(msg)
            }
          } catch (e) {}
        })
      })

      // Host sends first
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'Please check your audio')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      // Guest opens the thread and replies
      await openChatPanel(guest.page)
      await guest.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, hostIdentity)
      await guest.page.waitForTimeout(500)
      await guest.page.fill('#chat-input', 'Audio is fine now')
      await guest.page.click('#chat-send')

      // Host should receive the reply
      await host.page.waitForTimeout(3000)
      const hostReceived = await host.page.evaluate(() => window.__hostReceived)
      expect(hostReceived.length).toBeGreaterThan(0)
      expect(hostReceived.some(m => m.text === 'Audio is fine now')).toBe(true)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('private tab shows unread dot for incoming message', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Notify')
    try {
      await host.page.waitForTimeout(3000)

      // Open panel on guest, make sure tabs are visible, stay on Everyone
      await openChatPanel(guest.page)

      // No unread dot initially
      let dot = await guest.page.$('#pc-tabs [data-tab="private"] .pc-dot')
      expect(dot).toBeNull()

      // Host sends a private message to the guest
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'Notification test')
      await host.page.click('#chat-send')

      // Wait for delivery and UI update
      await guest.page.waitForTimeout(3000)

      // Red dot should appear on the Private tab
      dot = await guest.page.$('#pc-tabs [data-tab="private"] .pc-dot')
      expect(dot).not.toBeNull()

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('main Chat tab dot lights up when private message arrives while on People tab', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest MainDot')
    try {
      await host.page.waitForTimeout(3000)

      // Open guest's panel but keep on People tab (default after openPanel)
      await h.openPanel(guest.page)
      await guest.page.waitForTimeout(500)

      // Confirm guest is on People tab (tp-dot should be hidden)
      const dotHiddenInitially = await guest.page.$eval('#tp-dot', el => el.style.display === 'none')
      expect(dotHiddenInitially).toBe(true)

      // Host sends a private message
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'Main-dot test')
      await host.page.click('#chat-send')

      // Wait for delivery + UI update
      await guest.page.waitForTimeout(3000)

      // Main Chat tab dot should now be visible
      const dotVisible = await guest.page.$eval('#tp-dot', el =>
        el.style.display !== 'none' && el.style.display !== ''
      ).catch(() => false)
      expect(dotVisible).toBe(true)

      // Click Chat tab — dot should hide and Private sub-tab dot should be visible
      await guest.page.click('#right-panel .tp-tab[data-tab="chat"]')
      await guest.page.waitForTimeout(500)
      const mainDotHidden = await guest.page.$eval('#tp-dot', el => el.style.display === 'none')
      expect(mainDotHidden).toBe(true)
      const pcDot = await guest.page.$('#pc-tabs [data-tab="private"] .pc-dot')
      expect(pcDot).not.toBeNull()

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('private thread shows privacy notice and back button', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Label')
    try {
      await host.page.waitForTimeout(3000)

      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)

      // Should see privacy label
      const label = await host.page.$('.pc-private-label')
      expect(label).not.toBeNull()
      const text = await label.textContent()
      expect(text.toLowerCase()).toContain('private')
      expect(text.toLowerCase()).toContain('only you and')

      // Should have a back button
      const back = await host.page.$('.pc-thread-back')
      expect(back).not.toBeNull()

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  // ========= Extended tests: UX integration (added after prod regressions) =========

  test('public chat still works after returning from a private thread (no hijack leak)', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest LeakCheck')
    try {
      await host.page.waitForTimeout(3000)

      // Guest listens for ALL data messages, classifying them
      await guest.page.evaluate(() => {
        if (!window.__tenetRoom) throw new Error('no room')
        window.__publicMsgs = []
        window.__privateMsgs = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg.type === 'chat') window.__publicMsgs.push(msg.text)
            if (msg.type === 'private') window.__privateMsgs.push(msg.text)
          } catch (e) {}
        })
      })

      await openChatPanel(host.page)
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      // 1. Host sends a public message on Everyone tab
      await host.page.fill('#chat-input', 'public before')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      // 2. Host opens a private thread, sends a private message
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'secret')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      // 3. Host goes back to Everyone, sends another public message
      await host.page.click('#pc-tabs [data-tab="all"]')
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'public after')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      // Verify: both public messages arrived as type 'chat', secret as 'private'
      const result = await guest.page.evaluate(() => ({
        pub: window.__publicMsgs,
        priv: window.__privateMsgs
      }))
      expect(result.pub).toContain('public before')
      expect(result.pub).toContain('public after')
      expect(result.priv).toContain('secret')
      // Critical: 'public after' must NOT have been sent as private
      expect(result.priv).not.toContain('public after')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('public chat history is preserved across a private thread view', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest HistCheck')
    try {
      await host.page.waitForTimeout(3000)

      await openChatPanel(host.page)
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      // Host sends two public messages
      await host.page.fill('#chat-input', 'remembered one')
      await host.page.click('#chat-send')
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'remembered two')
      await host.page.click('#chat-send')
      await host.page.waitForTimeout(500)

      // Open private thread then go back
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.click('#pc-tabs [data-tab="all"]')
      await host.page.waitForTimeout(500)

      // #chat-messages must still contain both public messages
      const content = await host.page.$eval('#chat-messages', el => el.textContent)
      expect(content).toContain('remembered one')
      expect(content).toContain('remembered two')
      // And must not contain any private-only marker
      expect(content).not.toContain('only you and')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('top-bar #pc-unread badge appears when a private message arrives', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest BadgeCheck')
    try {
      await host.page.waitForTimeout(3000)

      // Before any private message, badge shouldn't exist OR shouldn't be "on"
      const initialState = await guest.page.evaluate(() => {
        const b = document.getElementById('pc-unread')
        return { exists: !!b, on: b ? b.classList.contains('on') : false }
      })
      expect(initialState.on).toBe(false)

      // Host sends a private message to guest
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'badge test')
      await host.page.click('#chat-send')

      // Wait for guest to receive + UI update
      await guest.page.waitForTimeout(3000)

      // Guest's #pc-unread must exist AND be .on
      const after = await guest.page.evaluate(() => {
        const b = document.getElementById('pc-unread')
        return {
          exists: !!b,
          on: b ? b.classList.contains('on') : false,
          count: b ? b.querySelector('.n')?.textContent : null,
          visible: b ? getComputedStyle(b).display !== 'none' : false
        }
      })
      expect(after.exists).toBe(true)
      expect(after.on).toBe(true)
      expect(after.visible).toBe(true)
      expect(after.count).toBe('1')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('top-bar #pc-unread clears when guest actively views the Private tab', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest ClearCheck')
    try {
      await host.page.waitForTimeout(3000)

      // Host sends a private message
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'clear test')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(3000)

      // Confirm badge is on
      const onBefore = await guest.page.evaluate(() =>
        document.getElementById('pc-unread')?.classList.contains('on') || false
      )
      expect(onBefore).toBe(true)

      // Guest opens the chat panel and switches to Private tab
      await openChatPanel(guest.page)
      await guest.page.click('#pc-tabs [data-tab="private"]')

      // Auto-clear polls every 2s; wait 4s to be safe
      await guest.page.waitForTimeout(4000)

      const onAfter = await guest.page.evaluate(() =>
        document.getElementById('pc-unread')?.classList.contains('on') || false
      )
      expect(onAfter).toBe(false)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('public chat badge (#chat-unread) auto-clears when viewing Everyone', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest PubClear')
    try {
      await host.page.waitForTimeout(3000)

      // Guest stays on default (panel closed). Host sends public — badge should fire
      await openChatPanel(host.page)
      await host.page.fill('#chat-input', 'auto-clear test')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      const onBefore = await guest.page.evaluate(() =>
        document.getElementById('chat-unread')?.classList.contains('on') || false
      )
      expect(onBefore).toBe(true)

      // Guest opens chat panel (Chat tab, Everyone sub-tab is default)
      await openChatPanel(guest.page)
      // Auto-clear polls every 1s; wait 3s
      await guest.page.waitForTimeout(3000)

      const onAfter = await guest.page.evaluate(() =>
        document.getElementById('chat-unread')?.classList.contains('on') || false
      )
      expect(onAfter).toBe(false)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('private thread view mirrors the chat-msg bubble styling', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest StyleCheck')
    try {
      await host.page.waitForTimeout(3000)

      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'bubble styled')
      await host.page.click('#chat-send')
      await host.page.waitForTimeout(1000)

      // #pc-thread-view: display flex, column direction, overflow auto
      const viewStyle = await host.page.evaluate(() => {
        const v = document.getElementById('pc-thread-view')
        if (!v) return null
        const cs = getComputedStyle(v)
        return {
          display: cs.display,
          flexDirection: cs.flexDirection,
          overflowY: cs.overflowY
        }
      })
      expect(viewStyle).not.toBeNull()
      expect(viewStyle.display).toBe('flex')
      expect(viewStyle.flexDirection).toBe('column')
      expect(['auto', 'scroll']).toContain(viewStyle.overflowY)

      // The "me" message bubble has a non-transparent background and rounded corners
      const bubbleStyle = await host.page.evaluate(() => {
        const me = document.querySelector('#pc-thread-view .chat-msg.me > div:last-child')
        if (!me) return null
        const cs = getComputedStyle(me)
        return {
          background: cs.backgroundColor,
          borderRadius: cs.borderRadius,
          display: cs.display
        }
      })
      expect(bubbleStyle).not.toBeNull()
      // rgba with non-zero alpha (not fully transparent)
      expect(bubbleStyle.background).not.toBe('rgba(0, 0, 0, 0)')
      expect(bubbleStyle.background).not.toBe('transparent')
      // border-radius should include at least one non-zero value
      expect(bubbleStyle.borderRadius).not.toBe('0px')
      // inline-block so the bubble hugs its content
      expect(bubbleStyle.display).toBe('inline-block')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('guest sees session-window status strip in a private thread', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest SessionLabel')
    try {
      await host.page.waitForTimeout(3000)

      // Host sends to guest
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'session hello')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(3000)

      // Guest opens the thread
      const hostIdentity = await host.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(guest.page)
      await guest.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, hostIdentity)
      await guest.page.waitForTimeout(500)

      // .pc-session element exists and tells the guest when they can reply until
      const statusText = await guest.page.$eval('.pc-session', el => el.textContent)
      expect(statusText.toLowerCase()).toContain('reply until')

      // Host should NOT see the session strip (no window limit for host)
      const hostHas = await host.page.evaluate(() => {
        return !!document.querySelector('.pc-session')
      })
      expect(hostHas).toBe(false)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('host sees badge when guest replies after host left the thread view', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest LeftThread')
    try {
      await host.page.waitForTimeout(3000)

      // Host opens private thread with guest
      const guestIdentity = await guest.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      const hostIdentity = await host.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )
      await openChatPanel(host.page)
      await host.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, guestIdentity)
      await host.page.waitForTimeout(500)
      await host.page.fill('#chat-input', 'from host')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2500)

      // Host leaves the thread view by switching the right-panel to People tab
      await host.page.click('#right-panel .tp-tab[data-tab="people"]')
      await host.page.waitForTimeout(500)

      // Guest replies privately
      await openChatPanel(guest.page)
      await guest.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, hostIdentity)
      await guest.page.waitForTimeout(500)
      await guest.page.fill('#chat-input', 'from guest')
      await guest.page.click('#chat-send')

      // Host should see the top-bar badge AND the Private sub-tab dot
      await host.page.waitForTimeout(3000)
      const state = await host.page.evaluate(() => {
        const bar = document.getElementById('pc-unread')
        const pcDot = document.querySelector('#pc-tabs [data-tab="private"] .pc-dot')
        return {
          barExists: !!bar,
          barOn: bar ? bar.classList.contains('on') : false,
          pcDot: !!pcDot
        }
      })
      expect(state.barExists).toBe(true)
      expect(state.barOn).toBe(true)
      expect(state.pcDot).toBe(true)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('clicking #chat-unread while on Private sub-tab brings user to Everyone', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest Everyone')
    try {
      await host.page.waitForTimeout(3000)

      // Guest opens chat panel and switches to Private sub-tab
      await openChatPanel(guest.page)
      await guest.page.click('#pc-tabs [data-tab="private"]')
      await guest.page.waitForTimeout(500)

      // Confirm Private is active
      const privActive = await guest.page.evaluate(() =>
        !!document.querySelector('#pc-tabs .pc-tab[data-tab="private"].active')
      )
      expect(privActive).toBe(true)

      // Host sends a public message — guest should see #chat-unread fire
      // (guest's right-panel is open, on Chat tab, but on Private sub-tab → viewingEveryone is false)
      await openChatPanel(host.page)
      await host.page.fill('#chat-input', 'everyone public')
      await host.page.click('#chat-send')
      await guest.page.waitForTimeout(2000)

      const barOn = await guest.page.evaluate(() =>
        document.getElementById('chat-unread')?.classList.contains('on') || false
      )
      expect(barOn).toBe(true)

      // Guest clicks the chat-unread button
      await guest.page.click('#chat-unread')
      await guest.page.waitForTimeout(500)

      // Must now be on the Everyone sub-tab
      const allActive = await guest.page.evaluate(() =>
        !!document.querySelector('#pc-tabs .pc-tab[data-tab="all"].active')
      )
      expect(allActive).toBe(true)

      // Public chat messages must be visible (not private)
      const chatVisible = await guest.page.$eval('#chat-messages', el =>
        el.style.display !== 'none' && getComputedStyle(el).display !== 'none'
      )
      expect(chatVisible).toBe(true)

      // Everyone chat content should include the message we just sent
      const content = await guest.page.$eval('#chat-messages', el => el.textContent)
      expect(content).toContain('everyone public')

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })

  test('guest cannot send in a thread that the host never opened (window empty)', async () => {
    const host = await h.joinAsHost(meetingId)
    const guest = await h.joinAsGuest(roomUuid, 'Guest NoWindow')
    try {
      await host.page.waitForTimeout(3000)

      // Guest tries to open a thread with host directly (bypass UI)
      const hostIdentity = await host.page.evaluate(() =>
        window.__tenetRoom.localParticipant.identity
      )

      // Host listener (should NOT receive the guest's attempt)
      await host.page.evaluate(() => {
        window.__hostGotPrivate = []
        window.__tenetRoom.on('dataReceived', (data) => {
          try {
            const msg = JSON.parse(new TextDecoder().decode(data))
            if (msg.type === 'private') window.__hostGotPrivate.push(msg.text)
          } catch (e) {}
        })
      })

      await openChatPanel(guest.page)
      await guest.page.evaluate((identity) => {
        window.TenetPrivateChat.openThread(identity)
      }, hostIdentity)
      await guest.page.waitForTimeout(500)

      // Guest's chat-input must be disabled (no window from host yet)
      const disabled = await guest.page.$eval('#chat-input', el => el.disabled)
      expect(disabled).toBe(true)

      // Attempt a send anyway via the UI
      await guest.page.evaluate(() => {
        const input = document.getElementById('chat-input')
        // Force enable to really test the backend guard
        input.disabled = false
        input.value = 'should not arrive'
      })
      await guest.page.click('#chat-send', { force: true }).catch(() => {})
      await host.page.waitForTimeout(3000)

      const hostGot = await host.page.evaluate(() => window.__hostGotPrivate)
      expect(hostGot.length).toBe(0)

      await h.expectHealthy(host.page)
      await h.expectHealthy(guest.page)
    } finally {
      await guest.browser.close()
      await host.browser.close()
    }
  })
})
