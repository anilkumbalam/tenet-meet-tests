// 12 - Screen sharing: one sharer at a time, host override (Stop sharing / take over),
// sharer indicator in the People panel, and a protected stop-share route.
const { test, expect, chromium } = require('@playwright/test')
const jwt = require('jsonwebtoken')
const { BASE_URL } = require('./env')

const JWT_SECRET   = process.env.JWT_SECRET   || 'your_jwt_secret_here'
const HOST_EMAIL   = process.env.HOST_EMAIL   || 'anil@tenetnetworks.com'
const HOST_DISPLAY = 'Anil Kumbalam'

const CHROME_ARGS = [
  '--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage',
  '--disable-gpu', '--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream',
]
const CHROME_PATH = '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome'

function forgeMeetToken (email, displayName, isAdmin = false) {
  return jwt.sign({ email, displayName, isAdmin }, JWT_SECRET, { expiresIn: '2h' })
}

async function setAuthCookie (context, email, displayName) {
  const token = forgeMeetToken(email, displayName)
  await context.addCookies([{
    name: 'meet_token', value: token,
    domain: new URL(BASE_URL).hostname, path: '/',
    httpOnly: true, secure: BASE_URL.startsWith('https'), sameSite: 'Lax',
  }])
}

// Fake camera/mic (silent audio), and a fake screen: a moving canvas so LiveKit gets a real video track
const mediaStub = () => {
  const mk = () => {
    try { return Promise.resolve(new AudioContext().createMediaStreamDestination().stream) }
    catch (e) { return Promise.resolve(new MediaStream()) }
  }
  navigator.mediaDevices.getUserMedia     = mk
  navigator.mediaDevices.enumerateDevices = async () => []
  navigator.mediaDevices.getDisplayMedia  = async () => {
    const c = document.createElement('canvas'); c.width = 1280; c.height = 720
    const g = c.getContext('2d'); let x = 0
    setInterval(() => {
      x = (x + 8) % 1160
      g.fillStyle = '#0f172a'; g.fillRect(0, 0, 1280, 720)
      g.fillStyle = '#f97316'; g.fillRect(x, 300, 120, 120)
    }, 66)
    return c.captureStream(15)
  }
}

async function launchBrowser () {
  return chromium.launch({ executablePath: CHROME_PATH, headless: true, args: CHROME_ARGS, ignoreHTTPSErrors: true })
}

async function finishJoin (page, who) {
  const avBtn = page.locator('#av-join-btn')
  await avBtn.waitFor({ state: 'visible', timeout: 15000 }).then(() => avBtn.click()).catch(() => {})
  try { await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 }) }
  catch { console.warn(`[${who}] loading screen timeout`) }
}

async function joinAsHost (meetingId) {
  const browser = await launchBrowser()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  await setAuthCookie(ctx, HOST_EMAIL, HOST_DISPLAY)
  const page = await ctx.newPage()
  const res = await page.request.post(`${BASE_URL}/api/meetings/${meetingId}/join`, { data: { device_id: `test-host-${Date.now()}` } })
  if (res.ok() === false) { await browser.close(); throw new Error(`Host join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  await finishJoin(page, 'Host')
  return { browser, page }
}

async function joinAsGuest (roomUuid, guestName) {
  const browser = await launchBrowser()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  const page = await ctx.newPage()
  const res = await page.request.post(`${BASE_URL}/api/guest-join/${roomUuid}`, { data: { display_name: guestName } })
  if (res.ok() === false) { await browser.close(); throw new Error(`[${guestName}] guest-join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  await finishJoin(page, guestName)
  return { browser, page }
}

// Is this page currently sharing its screen? (reads LiveKit state exposed as window.__tenetRoom)
const isSharing = page => page.evaluate(() => Boolean(window.__tenetRoom && window.__tenetRoom.localParticipant && window.__tenetRoom.localParticipant.isScreenShareEnabled))
const rowOf = (page, name) => page.locator('.participant-item').filter({ hasText: name })

async function openRowMenu (row) {
  const more = row.locator('.tp-more')
  if (await more.count() > 0 && await more.first().isVisible().catch(() => false)) {
    await more.first().click()
    await row.locator('.tp-menu.open').waitFor({ state: 'visible', timeout: 3000 }).catch(() => {})
  }
}

let meetingId, roomUuid
let host, alpha, beta

test.describe.serial('12 - Screen sharing', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    const setupCtx = await browser.newContext({ ignoreHTTPSErrors: true })
    await setAuthCookie(setupCtx, HOST_EMAIL, HOST_DISPLAY)
    const setupPage = await setupCtx.newPage()
    const mtgRes = await setupPage.request.post(`${BASE_URL}/api/meetings`, {
      data: { title: `screenshare-test-${Date.now().toString(36)}`, duration_minutes: 30 },
    })
    expect(mtgRes.ok()).toBeTruthy()
    const mtg = await mtgRes.json()
    meetingId = mtg.id; roomUuid = mtg.room_uuid
    await setupPage.close(); await setupCtx.close()

    host = await joinAsHost(meetingId)
    const panelHidden = await host.page.locator('#right-panel').getAttribute('class').then(c => (c || '').includes('hidden')).catch(() => true)
    if (panelHidden) { await host.page.locator('#btn-panel').click(); await host.page.waitForTimeout(500) }

    alpha = await joinAsGuest(roomUuid, 'Guest Alpha')
    beta  = await joinAsGuest(roomUuid, 'Guest Beta')
    await expect(host.page.locator('.participant-item')).toHaveCount(3, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && host) await host.page.request.post(`${BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [alpha, beta, host]) if (p) await p.browser.close().catch(() => {})
  })

  test('guest shares: host sees the share and a sharer icon on the guest row', async () => {
    await alpha.page.locator('#btn-screen').click()
    await expect.poll(() => isSharing(alpha.page), { timeout: 20000 }).toBe(true)
    await expect(host.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
    await expect(host.page.locator('#screenshare-banner')).toContainText('Guest Alpha')
    await expect(rowOf(host.page, 'Guest Alpha').locator('.ssc-ind')).toBeVisible({ timeout: 10000 })
  })

  test('one at a time: a second guest cannot start sharing', async () => {
    await expect(beta.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
    await beta.page.locator('#btn-screen').click()
    await expect(beta.page.locator('.ssc-toast')).toContainText('You can share when they stop', { timeout: 10000 })
    await beta.page.waitForTimeout(1500)
    expect(await isSharing(beta.page)).toBe(false)
  })

  test('host stops the guest share from the ⋯ menu', async () => {
    const row = rowOf(host.page, 'Guest Alpha')
    await openRowMenu(row)
    await row.locator('.ssc-stop').click()
    await expect.poll(() => isSharing(alpha.page), { timeout: 15000 }).toBe(false)
    await expect(alpha.page.locator('.ssc-toast')).toContainText('The host stopped your screen share', { timeout: 10000 })
    await expect(host.page.locator('#screenshare-overlay')).not.toHaveClass(/active/, { timeout: 15000 })
  })

  test('host takes over a guest share (Stop & share mine)', async () => {
    await alpha.page.locator('#btn-screen').click()
    await expect.poll(() => isSharing(alpha.page), { timeout: 20000 }).toBe(true)
    await expect(host.page.locator('#screenshare-overlay')).toHaveClass(/active/, { timeout: 20000 })
    await host.page.locator('#btn-screen').click()
    await expect(host.page.locator('.ssc-toast')).toContainText('Stop their share', { timeout: 10000 })
    await host.page.locator('.ssc-toast button', { hasText: 'Stop & share mine' }).click()
    await expect.poll(() => isSharing(alpha.page), { timeout: 20000 }).toBe(false)
    await expect.poll(() => isSharing(host.page), { timeout: 20000 }).toBe(true)
    await expect(alpha.page.locator('#screenshare-banner')).toContainText('Anil', { timeout: 20000 })
  })

  test('stop-share route refuses callers without host/co-host rights', async ({ request }) => {
    const res = await request.post(`${BASE_URL}/api/meetings/${meetingId}/stop-share/nobody`)
    expect(res.status()).toBe(403)
  })
})
