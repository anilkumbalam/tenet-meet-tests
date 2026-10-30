// 19 - Phones as participants: Android (390 and small 360), a phone held sideways, iPhone (Safari engine).
// Toolbar on one row with every button on screen; Chat opens as a full page and works both ways; the red
// unread icon opens the Chat tab; turning the phone; co-host tools on a phone; the phone's own camera; going to the background;
// a short network drop recovers by itself; a long one shows "Connection lost" with Rejoin (never a frozen page).
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

const PHONES = [
  ['Android phone 390x844', H.PHONE, 'chromium'],
  ['small phone 360x640', { ...H.PHONE, viewport: { width: 360, height: 640 } }, 'chromium'],
  ['phone sideways 844x390', { ...H.PHONE, viewport: { width: 844, height: 390 } }, 'chromium'],
  ['iPhone (Safari engine)', H.IPHONE, 'webkit'],
]
const TOOLBAR = ['#vbtn-grid', '#vbtn-speaker', '#vbtn-strip', '#btn-mic', '#btn-cam', '#btn-panel', '#btn-end']
const HOST_TOOLS = ['#btn-copy-link', '#btn-lock', '#btn-end-meeting']           // host / co-host only

let meetingId, roomUuid, api, host, desk, mobile, n = 0

// every toolbar button shown, on screen, not covered, all on one row; Share hidden; page not wider than the phone.
// With host tools: those are on screen too, on their own second row below the main one (one row when sideways).
async function expectToolbarFits (page, hostTools = false) {
  const all = hostTools ? TOOLBAR.concat(HOST_TOOLS) : TOOLBAR
  const s = await page.evaluate(ids => {
    const out = { iw: innerWidth, ih: innerHeight, sw: document.documentElement.scrollWidth, share: getComputedStyle(document.getElementById('btn-screen')).display, b: {} }
    for (const id of ids) { const r = document.querySelector(id).getBoundingClientRect(); out.b[id] = { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), b: Math.round(r.bottom) } }
    return out
  }, all)
  const info = JSON.stringify(s)
  expect(s.sw, 'page wider than the phone ' + info).toBeLessThanOrEqual(s.iw + 1)
  expect(s.share, 'Share is hidden on phones').toBe('none')
  for (const id of all) {
    const r = s.b[id]
    expect(r.l >= -1 && r.r <= s.iw + 1 && r.b <= s.ih + 1, id + ' on screen ' + info).toBe(true)
    expect(await H.clickable(page, id), id).toBe('ok')
  }
  const tops = TOOLBAR.map(id => s.b[id].t)
  expect(Math.max(...tops) - Math.min(...tops), 'toolbar on one row ' + info).toBeLessThanOrEqual(8)
  if (hostTools) {
    const ht = HOST_TOOLS.map(id => s.b[id].t)
    expect(Math.max(...ht) - Math.min(...ht), 'host tools on one row ' + info).toBeLessThanOrEqual(8)
    if (s.iw <= 600) expect(Math.min(...ht), 'host tools on a second row below ' + info).toBeGreaterThan(Math.max(...tops) + 20)
  }
}
const panelOpen = page => page.evaluate(() => document.getElementById('right-panel').classList.contains('hidden') === false)
async function showChatTab (page) {
  const tab = page.locator('.tp-tab[data-tab="chat"]')
  if (await tab.count() > 0 && await tab.isVisible()) await tab.click()
}
async function hostSays (text) {
  await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('chat'))
  await host.page.locator('#chat-input').fill(text)
  await host.page.locator('#chat-send').click()
}
const micOn = page => page.evaluate(() => window.__tenetRoom.localParticipant.isMicrophoneEnabled)
const micInfo = page => page.evaluate(() => {
  const L = window.LivekitClient, pub = window.__tenetRoom.localParticipant.getTrackPublication(L.Track.Source.Microphone)
  const t = pub && pub.track && pub.track.mediaStreamTrack
  return JSON.stringify({ button: document.getElementById('btn-mic').textContent.trim(), published: Boolean(pub), muted: pub && pub.isMuted, track: t && t.readyState, device: t && t.getSettings().deviceId })
})

test.describe.serial('19 - Phones', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'mobile'))
    host = await H.joinAsHost(meetingId)
    desk = await H.joinAsGuest(roomUuid, 'Guest Desk')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterEach(async () => { await H.expectHealthy(host, desk) })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [mobile, desk, host]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  for (const [label, device, engine] of PHONES) {
    test(`${label}: toolbar fits, mic works, chat opens full page and works both ways`, async () => {
      test.skip(await H.engineAvailable(engine) === false, engine + ' not installed')
      const ph = await H.joinAsGuest(roomUuid, 'Guest Phone ' + (++n), device, engine)
      try {
        const p = ph.page
        const logs = []; p.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') logs.push(m.text().slice(0, 160)) })
        await expect.poll(() => H.roomState(p), { timeout: 30000 }).toBe('connected')
        await expect(p.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
        expect(await panelOpen(p), 'phone starts on the videos').toBe(false)
        await expectToolbarFits(p)

        // mic button really mutes and unmutes
        // mic: on after joining, Mute turns it off, Unmute back on. The Safari test engine has no microphone at
        // all, so there it is only noted (a real iPhone has one).
        const before = await micOn(p)
        if (engine === 'webkit' && before === false) {
          test.info().annotations.push({ type: 'mic', description: 'Safari test engine: no microphone, mic check skipped' })
        } else {
          expect(before, 'mic is on after joining ' + await micInfo(p)).toBe(true)
          await p.locator('#btn-mic').click()
          await expect.poll(() => micOn(p), { timeout: 10000 }).toBe(false)
          await p.locator('#btn-mic').click()
          const stuck = await expect.poll(() => micOn(p), { timeout: 10000 }).toBe(true).then(() => null, e => e)
          if (stuck) throw new Error('mic did not come back on (' + label + '): ' + await micInfo(p) + ' | console: ' + logs.slice(-6).join(' || '))
        }

        // Chat button: People & Chat as a full page, videos behind it hidden
        await p.locator('#btn-panel').click()
        await expect.poll(() => panelOpen(p), { timeout: 5000 }).toBe(true)
        await showChatTab(p)
        const full = await p.evaluate(() => ({ w: Math.round(document.getElementById('right-panel').getBoundingClientRect().width), iw: innerWidth, videos: getComputedStyle(document.getElementById('video-grid-container')).display, sw: document.documentElement.scrollWidth }))
        expect(full.w, 'panel uses the full width ' + JSON.stringify(full)).toBeGreaterThanOrEqual(full.iw - 2)
        expect(full.videos, 'videos hidden behind the chat page').toBe('none')
        expect(full.sw).toBeLessThanOrEqual(full.iw + 1)
        await expect(p.locator('#chat-input')).toBeVisible()
        const mine = 'hello from ' + label
        await p.locator('#chat-input').fill(mine)
        await p.locator('#chat-send').click()
        await expect(host.page.locator('#chat-messages')).toContainText(mine, { timeout: 10000 })
        expect(await H.clickable(p, '#btn-panel'), 'Chat button still reachable to go back').toBe('ok')
        await p.locator('#btn-panel').click()
        await expect.poll(() => panelOpen(p), { timeout: 5000 }).toBe(false)
        await expect(p.locator('#video-grid .video-tile').first()).toBeVisible()

        // message from the host: red icon on the phone, toolbar still fits, tapping it opens the Chat tab
        await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
        await p.evaluate(() => { try { sessionStorage.setItem('tenetPanelTab', 'people') } catch (e) {} ; window.TenetPeople && window.TenetPeople.setTab('people') })
        await hostSays('reply to ' + label)
        await expect(p.locator('#chat-unread')).toBeVisible({ timeout: 10000 })
        await expectToolbarFits(p)
        expect(await H.clickable(p, '#chat-unread')).toBe('ok')
        await p.locator('#chat-unread').click()
        await expect.poll(() => panelOpen(p), { timeout: 5000 }).toBe(true)
        await expect(p.locator('#chat-input'), 'red icon opens the Chat tab').toBeVisible()
        await expect(p.locator('#chat-messages')).toContainText('reply to ' + label)
        await expect(p.locator('#chat-unread')).toBeHidden()
        await p.locator('#btn-panel').click()
        await expect.poll(() => panelOpen(p), { timeout: 5000 }).toBe(false)
        await H.expectHealthy(ph)
      } finally { await ph.browser.close().catch(() => {}) }
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    })
  }

  test('turning the phone mid-meeting: grid and toolbar fit both ways', async () => {
    mobile = await H.joinAsGuest(roomUuid, 'Guest Mobile', H.PHONE)
    const p = mobile.page
    await expect(p.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    for (const vp of [{ width: 844, height: 390 }, { width: 390, height: 844 }]) {
      await p.setViewportSize(vp)
      await p.waitForTimeout(800)
      await expectToolbarFits(p)
      const g = await H.rect(p, '#video-grid')
      expect(g.w > 100 && g.h > 100 && g.right <= vp.width + 1, 'grid shown ' + JSON.stringify(g)).toBe(true)
    }
    await H.expectHealthy(mobile)
  })

  test('made co-host on the phone: Copy Link, Lock, End Meeting on a second row, all on screen', async () => {
    const p = mobile.page
    await H.openPanel(host.page)
    await host.page.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('people'))
    const row = host.page.locator('.participant-item').filter({ hasText: 'Guest Mobile' })
    await H.openRowMenu(row)
    await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).click()
    await expect(p.locator('#btn-end-meeting')).toBeVisible({ timeout: 15000 })
    await expectToolbarFits(p, true)
    await p.setViewportSize({ width: 844, height: 390 })           // sideways: everything on one row
    await p.waitForTimeout(800)
    await expectToolbarFits(p, true)
    await p.setViewportSize({ width: 390, height: 844 })
    await p.waitForTimeout(800)
    await H.openRowMenu(row)                                         // back to a normal guest for the next tests
    await row.locator('.p-mod-btn', { hasText: 'Remove co-host' }).click()
    await expect(p.locator('#btn-end-meeting')).toBeHidden({ timeout: 15000 })
    await expectToolbarFits(p)
    await H.expectHealthy(mobile)
  })

  test('phone camera: the desktop receives the phone video upright', async () => {
    const p = mobile.page
    await p.evaluate(() => {                       // an upright 360x640 camera for this phone
      const real = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
      navigator.mediaDevices.getUserMedia = async c => {
        if (c === undefined || c.video === undefined || c.video === false) return real(c)
        const cv = document.createElement('canvas'); cv.width = 360; cv.height = 640
        const g = cv.getContext('2d'); let y = 0
        setInterval(() => { y = (y + 8) % 600; g.fillStyle = '#1e293b'; g.fillRect(0, 0, 360, 640); g.fillStyle = '#22c55e'; g.fillRect(140, y, 80, 40) }, 66)
        return cv.captureStream(15)
      }
    })
    const camOn = () => p.evaluate(() => window.__tenetRoom.localParticipant.isCameraEnabled)
    await p.locator('#btn-cam').click()
    const on = await expect.poll(camOn, { timeout: 5000 }).toBe(true).then(() => true, () => false)
    if (on === false) await p.locator('#btn-cam').click()      // the test browser had no camera at join, but the button thought it was on
    await expect.poll(camOn, { timeout: 15000 }).toBe(true)
    const upright = () => host.page.evaluate(() => [...document.querySelectorAll('#video-grid .video-tile video')].some(v => v.videoHeight > v.videoWidth && v.videoWidth > 0))
    await expect.poll(upright, { timeout: 30000, intervals: [1000] }).toBe(true)
    await p.locator('#btn-cam').click()
    await expect.poll(() => p.evaluate(() => window.__tenetRoom.localParticipant.isCameraEnabled), { timeout: 15000 }).toBe(false)
    await H.expectHealthy(mobile)
  })

  test('phone goes to the background for 10 s and comes back: still in the meeting', async () => {
    const p = mobile.page
    const setHidden = hidden => p.evaluate(h => {
      Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => h ? 'hidden' : 'visible' })
      Object.defineProperty(document, 'hidden', { configurable: true, get: () => h })
      document.dispatchEvent(new Event('visibilitychange'))
    }, hidden)
    await setHidden(true)
    await p.waitForTimeout(10000)
    await setHidden(false)
    await p.waitForTimeout(1500)
    expect(await H.roomState(p)).toBe('connected')
    await expect(p.locator('#video-grid .video-tile')).toHaveCount(3)
    await expect(p.locator('#rj-screen')).toHaveCount(0)
    expect(await p.evaluate(() => window.TenetWakeLock && window.TenetWakeLock.active()), 'screen kept awake again').toBe(true)
    await H.expectHealthy(mobile)
  })

  test('short network drop (4 s): reconnects by itself, no "Connection lost" screen', async () => {
    const p = mobile.page
    await mobile.ctx.setOffline(true)
    await p.evaluate(() => window.__tenetRoom.simulateScenario('signal-reconnect'))
    await p.waitForTimeout(4000)
    await mobile.ctx.setOffline(false)
    await expect.poll(() => H.roomState(p), { timeout: 45000, intervals: [1000] }).toBe('connected')
    await expect(p.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    await expect(p.locator('#rj-screen')).toHaveCount(0)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
    await H.expectHealthy(mobile)
  })

  test('long network drop: shows "Connection lost" with Rejoin that fits the phone (not a frozen page)', async () => {
    const p = mobile.page
    await mobile.ctx.setOffline(true)
    await p.evaluate(() => window.__tenetRoom.simulateScenario('signal-reconnect'))
    await expect(p.locator('#rj-screen'), 'LiveKit gives up after about 45 s, then 5 s more').toBeVisible({ timeout: 150000 })
    const s = await p.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: innerWidth }))
    expect(s.sw, JSON.stringify(s)).toBeLessThanOrEqual(s.iw + 1)
    expect(await H.clickable(p, '#rj-go')).toBe('ok')
    expect(await H.clickable(p, '#rj-leave')).toBe('ok')
    await mobile.ctx.setOffline(false)
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 60000 })   // others see the phone gone
    // what Rejoin leads to for a guest is recorded (not judged yet)
    await p.locator('#rj-go').click()
    await p.waitForLoadState('domcontentloaded').catch(() => {})
    await p.waitForTimeout(4000)
    test.info().annotations.push({ type: 'rejoin (guest)', description: p.url() + ' | state ' + await H.roomState(p).catch(() => '?') })
  })
})
