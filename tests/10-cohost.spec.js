const { test, expect, chromium } = require('@playwright/test')
const jwt = require('jsonwebtoken')

const BASE_URL     = process.env.BASE_URL     || 'https://meet.tenetnetworks.com'
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

const mediaStub = () => {
  const mk = () => {
    try { return Promise.resolve(new AudioContext().createMediaStreamDestination().stream) }
    catch (e) { return Promise.resolve(new MediaStream()) }
  }
  navigator.mediaDevices.getUserMedia     = mk
  navigator.mediaDevices.getDisplayMedia  = mk
  navigator.mediaDevices.enumerateDevices = async () => []
}

async function launchBrowser () {
  return chromium.launch({ executablePath: CHROME_PATH, headless: true, args: CHROME_ARGS, ignoreHTTPSErrors: true })
}

async function joinAsHost (meetingId) {
  const browser = await launchBrowser()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  await setAuthCookie(ctx, HOST_EMAIL, HOST_DISPLAY)
  const page = await ctx.newPage()
  const res = await page.request.post(`${BASE_URL}/api/meetings/${meetingId}/join`, {
    data: { device_id: `test-host-${Date.now()}` },
  })
  if (!res.ok()) { await browser.close(); throw new Error(`Host join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 8000 }).catch(() => false)) await avBtn.click()
  try { await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 }) }
  catch { console.warn('[Host] loading screen timeout') }
  return { browser, ctx, page }
}

async function joinAsGuest (roomUuid, guestName) {
  const browser = await launchBrowser()
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  const page = await ctx.newPage()
  const res = await page.request.post(`${BASE_URL}/api/guest-join/${roomUuid}`, {
    data: { display_name: guestName },
  })
  if (!res.ok()) { await browser.close(); throw new Error(`[${guestName}] guest-join failed ${res.status()}`) }
  const { url } = await res.json()
  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })
  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 8000 }).catch(() => false)) await avBtn.click()
  try { await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 }) }
  catch { console.warn(`[${guestName}] loading screen timeout`) }
  return { browser, ctx, page }
}

// ─── shared state ─────────────────────────────────────────────────────────────
let meetingId, roomUuid
let hostBrowser, hostPage
let cohostBrowser, cohostPage
let guestBrowser, guestPage

test.describe('10 - Co-host promotion and controls', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    // 1. Create meeting
    const setupCtx = await browser.newContext({ ignoreHTTPSErrors: true })
    await setAuthCookie(setupCtx, HOST_EMAIL, HOST_DISPLAY)
    const setupPage = await setupCtx.newPage()
    const mtgRes = await setupPage.request.post(`${BASE_URL}/api/meetings`, {
      data: { title: `cohost-test-${Date.now().toString(36)}`, duration_minutes: 30 },
    })
    expect(mtgRes.ok()).toBeTruthy()
    const mtg = await mtgRes.json()
    meetingId = mtg.id
    roomUuid  = mtg.room_uuid
    await setupPage.close(); await setupCtx.close()

    // 2. Host joins
    const h = await joinAsHost(meetingId)
    hostBrowser = h.browser; hostPage = h.page

    // 3. Open participants panel on host
    const panelHidden = await hostPage.locator('#right-panel').getAttribute('class')
      .then(c => (c || '').includes('hidden')).catch(() => true)
    if (panelHidden) { await hostPage.locator('#btn-panel').click(); await hostPage.waitForTimeout(500) }

    // 4. Two guests join — Alpha will become co-host, Beta is the third participant
    const results = await Promise.allSettled([
      joinAsGuest(roomUuid, 'Guest Alpha'),
      joinAsGuest(roomUuid, 'Guest Beta'),
    ])
    for (const r of results) {
      if (r.status === 'rejected') throw new Error(`Guest could not join: ${r.reason?.message}`)
    }
    cohostBrowser = results[0].value.browser; cohostPage = results[0].value.page
    guestBrowser  = results[1].value.browser; guestPage  = results[1].value.page

    // 5. Wait for all 3 to appear in host panel, then settle
    await expect(hostPage.locator('.participant-item')).toHaveCount(3, { timeout: 30000 })
    await hostPage.waitForTimeout(3000) // let LiveKit connections stabilise

    // 6. Promote Guest Alpha to co-host from host's panel
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    let promoted = false
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      const makeBtn = item.locator('.p-mod-btn').filter({ hasText: 'Make co-host' })
      if (await makeBtn.isVisible().catch(() => false)) {
        await makeBtn.click()
        promoted = true
        console.log('[Host] promoted Guest Alpha to co-host')
        break
      }
    }
    if (!promoted) throw new Error('Could not find Make co-host button — guests not in panel')

    // 7. Wait up to 20s for co-host browser to pick up promotion
    // (DataChannel fires immediately; server poll fallback fires within 15s)
    console.log('[Co-host] waiting for promotion to propagate...')
    await expect(cohostPage.locator('#btn-mute-all')).toBeVisible({ timeout: 30000 })
    console.log('[Co-host] promotion confirmed — Mute All now visible')
  })

  test.afterAll(async () => {
    if (meetingId && hostPage) {
      await hostPage.request.post(`${BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    }
    if (guestBrowser)  await guestBrowser.close().catch(() => {})
    if (cohostBrowser) await cohostBrowser.close().catch(() => {})
    if (hostBrowser)   await hostBrowser.close().catch(() => {})
  })

  // ── Tests ──────────────────────────────────────────────────────────────────

  test('host panel shows co-host badge on promoted guest', async () => {
    // Use .first() to avoid strict mode error when multiple items have mod-badge
    await expect(
      hostPage.locator('.participant-item').filter({ has: hostPage.locator('.mod-badge') }).first()
    ).toBeVisible({ timeout: 5000 })
    console.log('[Host] mod-badge visible in participant panel')
  })

  test('co-host sees Mute All button', async () => {
    // Already confirmed visible in beforeAll — just re-assert
    await expect(cohostPage.locator('#btn-mute-all')).toBeVisible()
    console.log('[Co-host] Mute All button visible')
  })

  test('co-host sees Unmute All button', async () => {
    await expect(cohostPage.locator('#btn-unmute-all')).toBeVisible()
  })

  test('co-host sees Lock button', async () => {
    await expect(cohostPage.locator('#btn-lock')).toBeVisible()
  })

  test('co-host participant panel shows kick and mute buttons for other guests', async () => {
    const panelHidden = await cohostPage.locator('#right-panel').getAttribute('class')
      .then(c => (c || '').includes('hidden')).catch(() => true)
    if (panelHidden) { await cohostPage.locator('#btn-panel').click(); await cohostPage.waitForTimeout(500) }

    await expect(cohostPage.locator('.kick-btn').first()).toBeVisible({ timeout: 10000 })
    console.log('[Co-host] kick button visible in panel')

    await expect(
      cohostPage.locator('.p-mod-btn').filter({ hasText: 'Mute' }).first()
    ).toBeVisible({ timeout: 5000 })
    console.log('[Co-host] individual Mute button visible in panel')
  })

  test('co-host can click Mute All', async () => {
    await cohostPage.locator('#btn-mute-all').click()
    await cohostPage.waitForTimeout(1500)
    await expect(cohostPage.locator('#btn-mute-all')).toBeVisible()
    console.log('[Co-host] Mute All clicked successfully')
  })

  test('co-host can lock the room', async () => {
    const lockBtn = cohostPage.locator('#btn-lock')
    await lockBtn.click()
    await cohostPage.waitForTimeout(1500)
    await expect(lockBtn).toBeVisible()
    console.log('[Co-host] Lock clicked successfully')
    await lockBtn.click() // unlock
    await cohostPage.waitForTimeout(1000)
  })

  test('co-host can remove Guest Beta', async () => {
    const items = cohostPage.locator('.participant-item')
    const countBefore = await items.count()
    expect(countBefore, 'Co-host panel must show participants to remove').toBeGreaterThan(1)

    let removed = false
    for (let i = 0; i < countBefore; i++) {
      const kickBtn = items.nth(i).locator('.kick-btn')
      if (await kickBtn.isVisible().catch(() => false)) {
        cohostPage.once('dialog', d => d.accept())
        await kickBtn.click()
        removed = true
        break
      }
    }
    expect(removed, 'No kick button found on co-host panel').toBe(true)
    await expect(cohostPage.locator('.participant-item'))
      .toHaveCount(countBefore - 1, { timeout: 15000 })
    console.log(`[Co-host] removed a guest — panel now shows ${countBefore - 1} participant(s)`)
  })

  test('regular guest does NOT see Mute All button', async () => {
    const visible = await guestPage.locator('#btn-mute-all').isVisible().catch(() => false)
    expect(visible, 'Regular guest should not see Mute All').toBe(false)
  })
})
