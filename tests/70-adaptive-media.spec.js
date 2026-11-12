// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  70 – Adaptive media
  Tests that the adaptive-media module loads, exposes its API,
  responds to quality changes, and coordinates with camera state.
*/

test.describe('70 – adaptive media', () => {
  let meetingId, roomUuid, api

  test.beforeAll(async ({ browser }) => {
    const m = await h.createMeeting(browser, 'am70')
    meetingId = m.meetingId
    roomUuid = m.roomUuid
    api = m.api
  })

  test.afterAll(async () => { if (api) await api.close() })

  test('module loads and exposes TenetAdaptiveMedia', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      const result = await host.page.evaluate(() => {
        const am = window.TenetAdaptiveMedia
        return am ? { level: am.level(), paused: am.isVideoPausedByConnection() } : null
      })
      expect(result).not.toBeNull()
      expect(result.level).toBeTruthy()
      expect(result.paused).toBe(false)
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('baseline: excellent/good keeps video enabled', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      const state = await host.page.evaluate(() => ({
        level: window.TenetAdaptiveMedia.level(),
        paused: window.TenetAdaptiveMedia.isVideoPausedByConnection()
      }))
      expect(['excellent', 'good']).toContain(state.level)
      expect(state.paused).toBe(false)

      // No adaptive banner should be visible
      const bannerVisible = await host.page.evaluate(() => {
        var b = document.getElementById('am-banner')
        return b ? (b.style.display !== 'none' && b.style.opacity !== '0') : false
      })
      expect(bannerVisible).toBe(false)
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('simulated poor quality fires event and shows banner', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      // Listen for the custom event
      await host.page.evaluate(() => {
        window.__amEvents = []
        document.addEventListener('tenet:quality:level', e => {
          window.__amEvents.push(e.detail)
        })
      })

      // Mock connectionQuality to 'poor'
      await host.page.evaluate(() => {
        Object.defineProperty(window.__tenetRoom.localParticipant, 'connectionQuality', {
          get: () => 'poor', configurable: true
        })
      })

      // Wait for the 3s poll to fire
      await host.page.waitForTimeout(4000)

      const events = await host.page.evaluate(() => window.__amEvents)
      const poorEvent = events.find(e => e.level === 'poor')
      expect(poorEvent).toBeTruthy()
      expect(poorEvent.videoPaused).toBe(true)
      expect(poorEvent.audioBitrate).toBe(32000)

      // Banner should be visible with connection text
      const bannerText = await host.page.$eval('#am-banner', el => el.textContent).catch(() => '')
      expect(bannerText.toLowerCase()).toContain('connection')

      // Restore quality
      await host.page.evaluate(() => {
        delete window.__tenetRoom.localParticipant.connectionQuality
      })
      await host.page.waitForTimeout(4000)

      // Banner should hide on recovery
      const hidden = await host.page.evaluate(() => {
        var b = document.getElementById('am-banner')
        return !b || b.style.display === 'none' || b.style.opacity === '0'
      })
      expect(hidden).toBe(true)

      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('lost quality fires event with video paused and shows audio-only banner', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      // Listen for the custom event — same pattern as 'poor' test
      await host.page.evaluate(() => {
        window.__amEvents = []
        document.addEventListener('tenet:quality:level', e => {
          window.__amEvents.push(e.detail)
        })
      })

      await host.page.evaluate(() => {
        Object.defineProperty(window.__tenetRoom.localParticipant, 'connectionQuality', {
          get: () => 'lost', configurable: true
        })
      })
      await host.page.waitForTimeout(4000)

      const events = await host.page.evaluate(() => window.__amEvents)
      const lostEvent = events.find(e => e.level === 'lost')
      expect(lostEvent).toBeTruthy()
      expect(lostEvent.videoPaused).toBe(true)
      expect(lostEvent.audioBitrate).toBe(24000)

      // Level getter should reflect lost state
      const level = await host.page.evaluate(() => window.TenetAdaptiveMedia.level())
      expect(level).toBe('lost')

      // Banner text should mention weak connection or audio-only
      const bannerText = await host.page.$eval('#am-banner', el => el.textContent).catch(() => '')
      expect(bannerText.toLowerCase()).toMatch(/weak|audio only/)

      await host.page.evaluate(() => {
        delete window.__tenetRoom.localParticipant.connectionQuality
      })
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('app.js publishes with VP9 codec and 64 kbps audio', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      const defaults = await host.page.evaluate(() => {
        var r = window.__tenetRoom
        if (!r || !r.options) return null
        var pd = r.options.publishDefaults || {}
        return { videoCodec: pd.videoCodec || null, maxBitrate: pd.audioPreset ? pd.audioPreset.maxBitrate : null }
      })
      expect(defaults).not.toBeNull()
      expect(defaults.videoCodec).toBe('vp9')
      expect(defaults.maxBitrate).toBe(64000)
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })

  test('app.js sets audioCaptureDefaults: noise suppression, echo cancellation, AGC on', async () => {
    const host = await h.joinAsHost(meetingId)
    try {
      const caps = await host.page.evaluate(() => {
        var r = window.__tenetRoom
        if (!r || !r.options) return null
        return r.options.audioCaptureDefaults || null
      })
      expect(caps).not.toBeNull()
      expect(caps.noiseSuppression).toBe(true)
      expect(caps.echoCancellation).toBe(true)
      expect(caps.autoGainControl).toBe(true)
      expect(caps.sampleRate).toBe(48000)
      expect(caps.channelCount).toBe(1)
      await h.expectHealthy(host.page)
    } finally { await host.browser.close() }
  })
})
