// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  72 - Cross-browser smoke: the critical in-meeting paths must work the same
  on Chromium, Firefox and WebKit. Would have caught the Firefox-defaults-off
  noiseSuppression gap (the SDK quietly produced a noisier publish on Firefox
  than on Chrome).

  Per engine:
  - module globals load (room, adaptive media, private chat)
  - audioCaptureDefaults is on (noise suppression, echo cancellation, AGC)
  - public chat send is received by a guest
  - private chat send is received by the targeted guest
*/

async function openChatPanel (page) {
  await h.openPanel(page)
  await page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
  await page.waitForSelector('#pc-tabs', { timeout: 8000 })
}

for (const engine of ['chromium', 'firefox', 'webkit']) {
  test.describe(`72 - cross-browser smoke (${engine})`, () => {
    let meetingId, roomUuid, api

    test.beforeAll(async ({ browser }) => {
      if (!(await h.engineAvailable(engine))) test.skip(true, `${engine} engine not installed`)
      const m = await h.createMeeting(browser, 'xb72')
      meetingId = m.meetingId
      roomUuid = m.roomUuid
      api = m.api
    })

    test.afterAll(async () => { if (api) await api.close() })

    test(`host joins; room, modules and audioCaptureDefaults are correct`, async () => {
      if (!(await h.engineAvailable(engine))) test.skip(true, `${engine} not installed`)
      const host = await h.joinAsHost(meetingId, h.DESKTOP, engine)
      try {
        const state = await host.page.evaluate(() => {
          const r = window.__tenetRoom
          const caps = r && r.options && r.options.audioCaptureDefaults
          return {
            roomExists: Boolean(r),
            noiseSuppression: caps ? caps.noiseSuppression : null,
            echoCancellation: caps ? caps.echoCancellation : null,
            autoGainControl: caps ? caps.autoGainControl : null,
            adaptiveMedia: typeof window.TenetAdaptiveMedia === 'object' && window.TenetAdaptiveMedia !== null,
            privateChat: typeof window.TenetPrivateChat === 'object' && window.TenetPrivateChat !== null
          }
        })
        expect(state.roomExists).toBe(true)
        expect(state.noiseSuppression).toBe(true)
        expect(state.echoCancellation).toBe(true)
        expect(state.autoGainControl).toBe(true)
        expect(state.adaptiveMedia).toBe(true)
        expect(state.privateChat).toBe(true)
        await h.expectHealthy(host.page)
      } finally { await host.browser.close() }
    })

    test(`public chat: host send reaches guest`, async () => {
      if (!(await h.engineAvailable(engine))) test.skip(true, `${engine} not installed`)
      const host = await h.joinAsHost(meetingId, h.DESKTOP, engine)
      const guest = await h.joinAsGuest(roomUuid, 'Guest XB Pub', h.DESKTOP, engine)
      try {
        await host.page.waitForTimeout(3000)

        await guest.page.evaluate(() => {
          window.__xbChatMsgs = []
          window.__tenetRoom.on('dataReceived', (data) => {
            try {
              const msg = JSON.parse(new TextDecoder().decode(data))
              if (msg && msg.type === 'chat') window.__xbChatMsgs.push(msg.text)
            } catch (e) {}
          })
        })

        await openChatPanel(host.page)
        await host.page.fill('#chat-input', `public via ${engine}`)
        await host.page.click('#chat-send')
        await guest.page.waitForTimeout(3000)

        const got = await guest.page.evaluate(() => window.__xbChatMsgs)
        expect(got).toContain(`public via ${engine}`)

        await h.expectHealthy(host.page)
        await h.expectHealthy(guest.page)
      } finally {
        await guest.browser.close()
        await host.browser.close()
      }
    })

    test(`private chat: host send reaches only the targeted guest`, async () => {
      if (!(await h.engineAvailable(engine))) test.skip(true, `${engine} not installed`)
      const host = await h.joinAsHost(meetingId, h.DESKTOP, engine)
      const guest = await h.joinAsGuest(roomUuid, 'Guest XB Priv', h.DESKTOP, engine)
      try {
        await host.page.waitForTimeout(3000)

        await guest.page.evaluate(() => {
          window.__xbPrivMsgs = []
          window.__tenetRoom.on('dataReceived', (data) => {
            try {
              const msg = JSON.parse(new TextDecoder().decode(data))
              if (msg && msg.type === 'private') window.__xbPrivMsgs.push(msg.text)
            } catch (e) {}
          })
        })

        const guestIdentity = await guest.page.evaluate(() =>
          window.__tenetRoom.localParticipant.identity
        )
        await openChatPanel(host.page)
        await host.page.evaluate((id) => window.TenetPrivateChat.openThread(id), guestIdentity)
        await host.page.waitForTimeout(500)
        await host.page.fill('#chat-input', `private via ${engine}`)
        await host.page.click('#chat-send')
        await guest.page.waitForTimeout(3000)

        const got = await guest.page.evaluate(() => window.__xbPrivMsgs)
        expect(got).toContain(`private via ${engine}`)

        await h.expectHealthy(host.page)
        await h.expectHealthy(guest.page)
      } finally {
        await guest.browser.close()
        await host.browser.close()
      }
    })
  })
}
