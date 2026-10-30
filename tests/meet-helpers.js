// Shared helpers for the meeting-room specs (13, 14): sign-in cookie, fake media, join as host / guest,
// and small DOM checks. Same approach as 12-screenshare.spec.js (which keeps its own copy).
const { expect, chromium, firefox, webkit, devices } = require('@playwright/test')
const jwt = require('jsonwebtoken')
const { BASE_URL } = require('./env')

const JWT_SECRET   = process.env.JWT_SECRET   || 'your_jwt_secret_here'
const HOST_EMAIL   = process.env.HOST_EMAIL   || 'anil@tenetnetworks.com'
const HOST_DISPLAY = 'Anil Kumbalam'
const CHROME_PATH  = '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'
const CHROME_ARGS  = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
]
const DESKTOP = { viewport: { width: 1280, height: 800 } }
const PHONE   = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 }
const IPHONE  = devices['iPhone 13']                 // Safari engine (WebKit), phone size, touch

async function setAuthCookie (context, email = HOST_EMAIL, displayName = HOST_DISPLAY) {
  const token = jwt.sign({ email, displayName, isAdmin: false }, JWT_SECRET, { expiresIn: '2h' })
  await context.addCookies([{
    name: 'meet_token', value: token, domain: new URL(BASE_URL).hostname, path: '/',
    httpOnly: true, secure: BASE_URL.startsWith('https'), sameSite: 'Lax',
  }])
}

// Silent mic, no camera, and a fake screen (moving canvas) for getDisplayMedia
const mediaStub = () => {
  if (!navigator.mediaDevices) return            // blank / insecure pages have no media API
  // Fake microphone. Its audio engine is kept alive, and it reports the device the app asked for, like a real
  // mic does (otherwise LiveKit thinks the mic changed on unmute, restarts it and fails).
  const mk = (c) => {
    let s
    try { const ac = new AudioContext(); (window.__fakeAudio = window.__fakeAudio || []).push(ac); s = ac.createMediaStreamDestination().stream }
    catch (e) { s = new MediaStream() }
    const a = c && c.audio, d = a && a.deviceId
    const want = (typeof d === 'string' ? d : d && (d.exact || d.ideal)) || 'fake-mic'
    s.getAudioTracks().forEach(t => { const g = t.getSettings.bind(t); t.getSettings = () => Object.assign(g(), { deviceId: want }) })
    return Promise.resolve(s)
  }
  navigator.mediaDevices.getUserMedia     = mk
  navigator.mediaDevices.enumerateDevices = async () => []
  // Fake screen: size set by window.__screenSize = [w, h] (default 1280x720). Like Chrome, it is shrunk to fit
  // the width/height the app asks for (number, {max} or {ideal}), keeping its shape. Records what happened.
  navigator.mediaDevices.getDisplayMedia  = async (constraints) => {
    const [sw, sh] = window.__screenSize || [1280, 720]
    const v = (constraints && constraints.video) || {}
    const lim = x => typeof x === 'number' ? x : (x && (x.max || x.ideal || x.exact)) || Infinity
    const k = Math.min(1, lim(v.width) / sw, lim(v.height) / sh)
    const W = Math.round(sw * k), H = Math.round(sh * k)
    window.__lastScreen = { asked: { width: lim(v.width), height: lim(v.height) }, captured: [W, H] }
    const c = document.createElement('canvas'); c.width = W; c.height = H
    const g = c.getContext('2d'); let x = 0; const box = Math.max(40, Math.round(H / 6))
    setInterval(() => {
      x = (x + Math.max(4, Math.round(W / 160))) % Math.max(1, W - box)
      g.fillStyle = '#0f172a'; g.fillRect(0, 0, W, H)
      g.fillStyle = '#334155'; for (let y = 20; y < H; y += 24) g.fillRect(20, y, W - 40, 2)
      g.fillStyle = '#f97316'; g.fillRect(x, Math.round(H / 2 - box / 2), box, box)
    }, 66)
    return c.captureStream(15)
  }
}

// engine: 'chromium' (default, the suite's Chrome), 'firefox' or 'webkit' (Safari engine)
async function launch (engine = 'chromium') {
  // Inside the test runner, the config's Chrome launchOptions (executablePath, args) apply to every engine,
  // so Firefox/WebKit must name their own browser and drop Chrome's arguments.
  if (engine === 'firefox') return firefox.launch({ headless: true, executablePath: firefox.executablePath(), args: [], firefoxUserPrefs: { 'media.navigator.streams.fake': true, 'media.navigator.permission.disabled': true } })
  if (engine === 'webkit') return webkit.launch({ headless: true, executablePath: webkit.executablePath(), args: [] })
  return chromium.launch({ executablePath: CHROME_PATH, headless: true, args: CHROME_ARGS })
}

// Can this engine start on this machine? (Firefox / WebKit need 'npx playwright install firefox webkit')
async function engineAvailable (engine) {
  try { const b = await launch(engine); await b.close(); return true }
  catch (e) { console.warn(`[${engine}] cannot start: ${String(e.message).split('\\n').slice(0, 6).join(' | ')}`); return false }
}

// Record uncaught page errors (exceptions and unhandled promise rejections) for expectHealthy()
function track (page) {
  page.__errs = []
  page.on('pageerror', e => page.__errs.push(String((e && e.message) || e)))
}

// Every given person's page: no uncaught errors so far, and still responding (not frozen)
const IGNORED_ERRORS = [/ResizeObserver loop/i]
async function expectHealthy (...people) {
  for (const x of people) {
    if (!x || !x.page || x.page.isClosed()) continue
    const errs = (x.page.__errs || []).filter(e => IGNORED_ERRORS.some(r => r.test(e)) === false)
    expect(errs, `uncaught page errors on ${x.name}`).toEqual([])
    const r = await Promise.race([x.page.evaluate(() => 'ok').catch(() => 'gone'), new Promise(res => setTimeout(() => res('frozen'), 5000))])
    expect(r === 'ok' || r === 'gone', `${x.name}'s page responds (got ${r})`).toBe(true)
  }
}

async function newCtx (browser, device = DESKTOP) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, ...device })   // no permission list: it would refuse everything else (e.g. wake lock)
  await ctx.addInitScript(mediaStub)
  return ctx
}

async function finishJoin (page, who) {
  const avBtn = page.locator('#av-join-btn')
  await avBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => avBtn.click()).catch(() => {})
  try { await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 25000 }) }
  catch { console.warn(`[${who}] loading screen timeout`) }
}

async function joinAsHost (meetingId, device = DESKTOP, engine = 'chromium') {
  const browser = await launch(engine)
  const ctx = await newCtx(browser, device)
  await setAuthCookie(ctx)
  const page = await ctx.newPage()
  track(page)
  const res = await page.request.post(`${BASE_URL}/api/meetings/${meetingId}/join`, { data: { device_id: `test-host-${Date.now()}` } })
  if (res.ok() === false) { await browser.close(); throw new Error(`Host join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  await finishJoin(page, 'Host')
  return { browser, ctx, page, name: 'Host' }
}

async function joinAsGuest (roomUuid, guestName, device = DESKTOP, engine = 'chromium') {
  const browser = await launch(engine)
  const ctx = await newCtx(browser, device)
  const page = await ctx.newPage()
  track(page)
  const res = await page.request.post(`${BASE_URL}/api/guest-join/${roomUuid}`, { data: { display_name: guestName } })
  if (res.ok() === false) { await browser.close(); throw new Error(`[${guestName}] guest-join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  await finishJoin(page, guestName)
  return { browser, ctx, page, name: guestName }
}

async function createMeeting (browser, prefix) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
  await setAuthCookie(ctx)
  const page = await ctx.newPage()
  const res = await page.request.post(`${BASE_URL}/api/meetings`, { data: { title: `${prefix}-${Date.now().toString(36)}`, duration_minutes: 30 } })
  expect(res.ok()).toBeTruthy()
  const m = await res.json()
  return { meetingId: m.id, roomUuid: m.room_uuid, api: ctx }   // keep ctx: signed-in API calls
}

async function meetingStatus (api, meetingId) {
  const r = await api.request.get(`${BASE_URL}/api/meetings/${meetingId}/status`)
  return r.ok() ? r.json() : {}
}

const isSharing = page => page.evaluate(() => Boolean(window.__tenetRoom && window.__tenetRoom.localParticipant && window.__tenetRoom.localParticipant.isScreenShareEnabled))
const roomState = page => page.evaluate(() => (window.__tenetRoom && window.__tenetRoom.state) || 'none')

// Is the centre of this element actually reachable by a click (not covered by something else)?
const clickable = (page, sel) => page.evaluate(s => {
  const b = document.querySelector(s); if (b === null) return 'missing'
  const r = b.getBoundingClientRect(); if (r.width === 0) return 'not shown'
  const e = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2)
  return (e === b || b.contains(e)) ? 'ok' : 'covered by ' + (e ? (e.id || e.className || e.tagName) : 'nothing')
}, sel)

const rect = (page, sel) => page.evaluate(s => {
  const e = document.querySelector(s); if (e === null) return null
  const r = e.getBoundingClientRect()
  return { top: Math.round(r.top), left: Math.round(r.left), right: Math.round(r.right), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) }
}, sel)

// Open the People & Chat panel if it is closed
async function openPanel (page) {
  const hidden = await page.locator('#right-panel').getAttribute('class').then(c => (c || '').includes('hidden')).catch(() => true)
  if (hidden) { await page.locator('#btn-panel').click(); await page.waitForTimeout(500) }
}

// Open a participant row's ⋯ menu (People panel)
async function openRowMenu (row) {
  const more = row.locator('.tp-more')
  if (await more.count() > 0 && await more.first().isVisible().catch(() => false)) {
    await more.first().click()
    await row.locator('.tp-menu.open').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  }
}

module.exports = {
  BASE_URL, HOST_EMAIL, HOST_DISPLAY, DESKTOP, PHONE, IPHONE, launch, engineAvailable, expectHealthy,
  setAuthCookie, joinAsHost, joinAsGuest, finishJoin, createMeeting, meetingStatus,
  isSharing, roomState, clickable, rect, openPanel, openRowMenu,
}
