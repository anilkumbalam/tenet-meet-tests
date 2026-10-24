const { test, expect, chromium } = require('@playwright/test')
const jwt = require('jsonwebtoken')

const BASE_URL     = process.env.BASE_URL     || 'https://meet.tenetnetworks.com'
const JWT_SECRET   = process.env.JWT_SECRET   || 'your_jwt_secret_here'
const HOST_EMAIL   = process.env.HOST_EMAIL   || 'anil@tenetnetworks.com'
const HOST_DISPLAY = 'Anil Kumbalam'

const CHROME_ARGS = [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
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
    try {
      const ac = new AudioContext()
      return Promise.resolve(ac.createMediaStreamDestination().stream)
    } catch (e) { return Promise.resolve(new MediaStream()) }
  }
  navigator.mediaDevices.getUserMedia     = mk
  navigator.mediaDevices.getDisplayMedia  = mk
  navigator.mediaDevices.enumerateDevices = async () => []
}

async function launchBrowser () {
  return chromium.launch({
    executablePath: CHROME_PATH,
    headless: true,
    args: CHROME_ARGS,
    ignoreHTTPSErrors: true,
  })
}

async function joinAsHost (meetingId, hostEmail, hostDisplay) {
  const browser = await launchBrowser()
  const ctx     = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  await setAuthCookie(ctx, hostEmail, hostDisplay)
  const page = await ctx.newPage()

  const joinRes = await page.request.post(`${BASE_URL}/api/meetings/${meetingId}/join`, {
    data: { device_id: `test-host-${Date.now()}` },
  })
  if (!joinRes.ok()) {
    await browser.close()
    throw new Error(`Host join API failed ${joinRes.status()}: ${await joinRes.text()}`)
  }
  const { url } = await joinRes.json()

  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })

  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 8000 }).catch(() => false)) await avBtn.click()

  try {
    await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 })
  } catch {
    console.warn('[Host] loading screen timeout')
  }

  return { browser, ctx, page }
}

async function joinAsGuest (roomUuid, guestName) {
  const browser = await launchBrowser()
  const ctx     = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  const page = await ctx.newPage()

  const joinRes = await page.request.post(`${BASE_URL}/api/guest-join/${roomUuid}`, {
    data: { display_name: guestName },
  })
  if (!joinRes.ok()) {
    await browser.close()
    throw new Error(`[${guestName}] guest-join API ${joinRes.status()}: ${await joinRes.text()}`)
  }
  const { url } = await joinRes.json()
  console.log(`[${guestName}] meeting URL: ${url}`)

  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })

  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 8000 }).catch(() => false)) await avBtn.click()

  try {
    await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 })
  } catch {
    console.warn(`[${guestName}] loading screen timeout — URL: ${page.url()}`)
  }

  return { browser, ctx, page }
}

let meetingId, roomUuid, roomCode
let hostBrowser, hostCtx, hostPage
let guests = []

test.describe('08 - Room controls (host + 3 guests)', () => {

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    const setupCtx  = await browser.newContext({ ignoreHTTPSErrors: true })
    await setAuthCookie(setupCtx, HOST_EMAIL, HOST_DISPLAY)
    const setupPage = await setupCtx.newPage()

    const mtgRes = await setupPage.request.post(`${BASE_URL}/api/meetings`, {
      data: { title: `rc-test-${Date.now().toString(36)}`, duration_minutes: 30 },
    })
    expect(mtgRes.ok()).toBeTruthy()
    const mtg = await mtgRes.json()
    meetingId = mtg.id
    roomUuid  = mtg.room_uuid
    roomCode  = mtg.room_code || mtg.room_uuid
    await setupPage.close()
    await setupCtx.close()

    const h = await joinAsHost(meetingId, HOST_EMAIL, HOST_DISPLAY)
    hostBrowser = h.browser
    hostCtx     = h.ctx
    hostPage    = h.page

    const panelHidden = await hostPage.locator('#right-panel').getAttribute('class')
      .then(c => (c || '').includes('hidden')).catch(() => true)
    if (panelHidden) {
      await hostPage.locator('#btn-panel').click()
      await hostPage.waitForTimeout(500)
    }

    const guestNames = ['Guest Alpha', 'Guest Beta', 'Guest Gamma']
    const results = await Promise.allSettled(
      guestNames.map(name => joinAsGuest(roomUuid, name))
    )
    for (let i = 0; i < results.length; i++) {
      const r = results[i]
      if (r.status === 'fulfilled') {
        guests.push({ ...r.value, name: guestNames[i] })
      } else {
        throw new Error(`Guest ${guestNames[i]} could not join: ${r.reason?.message}`)
      }
    }

    await new Promise(r => setTimeout(r, 5000))
  })

  test.afterAll(async () => {
    for (const g of guests) {
      if (g.browser) await g.browser.close().catch(() => {})
    }
    guests = []
    if (meetingId && hostPage) {
      await hostPage.request.post(`${BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    }
    if (hostBrowser) await hostBrowser.close().catch(() => {})
  })

  test('host is taken to the meeting room', async () => {
    await expect(hostPage).toHaveURL(new RegExp(`/meeting/${roomCode}`))
    await expect(hostPage.locator('#room-name-display')).toBeVisible()
  })

  test('host sees tiles for all 4 participants (self + 3 guests)', async () => {
    await expect(hostPage.locator('.video-tile')).toHaveCount(4, { timeout: 30000 })
    const count = await hostPage.locator('.video-tile').count()
    console.log(`Tile count: ${count}`)
  })

  test('all 3 guests are on the meeting room page', async () => {
    expect(guests).toHaveLength(3)
    for (const { page, name } of guests) {
      console.log(`[${name}] URL: ${page.url()}`)
      expect(page.url()).toMatch(/\/meeting\//)
    }
  })

  test('host can open the participants panel', async () => {
    const panel = hostPage.locator('#right-panel')
    const panelHidden = await panel.getAttribute('class').then(c => (c || '').includes('hidden')).catch(() => true)
    if (panelHidden) {
      await hostPage.locator('#btn-panel').click()
      await hostPage.waitForTimeout(500)
    }
    await expect(panel).toBeVisible()
  })

  test('participants panel shows all 4 entries (host + 3 guests)', async () => {
    const items = hostPage.locator('.participant-item')
    await expect(items).toHaveCount(4, { timeout: 30000 })
    const count = await items.count()
    console.log(`Panel shows ${count} participant(s)`)
  })

  test('host can click Mute All', async () => {
    await expect(hostPage.locator('#btn-mute-all')).toBeVisible({ timeout: 8000 })
    await hostPage.locator('#btn-mute-all').click()
    await hostPage.waitForTimeout(1500)
    await expect(hostPage.locator('#btn-mute-all')).toBeVisible()
  })

  test('host can click Unmute All', async () => {
    await expect(hostPage.locator('#btn-unmute-all')).toBeVisible({ timeout: 5000 })
    await hostPage.locator('#btn-unmute-all').click()
    await hostPage.waitForTimeout(1500)
    await expect(hostPage.locator('#btn-unmute-all')).toBeVisible()
  })

  test('host can mute and unmute an individual guest', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.p-mod-btn').filter({ hasText: 'Mute' }).isVisible().catch(() => false)) {
        target = item; break
      }
    }
    expect(target, 'No Mute button found — guests not in panel').not.toBeNull()
    await target.locator('.p-mod-btn').filter({ hasText: 'Mute' }).click()
    await hostPage.waitForTimeout(1500)
    const unmuteBtn = target.locator('.p-mod-btn').filter({ hasText: 'Unmute' })
    if (await unmuteBtn.isVisible({ timeout: 3000 }).catch(() => false)) await unmuteBtn.click()
  })

  test('host can promote a guest to co-host', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.p-mod-btn').filter({ hasText: 'Make co-host' }).isVisible().catch(() => false)) {
        target = item; break
      }
    }
    expect(target, 'No Make co-host button found — guests not in panel').not.toBeNull()
    await target.locator('.p-mod-btn').filter({ hasText: 'Make co-host' }).click()
    await hostPage.waitForTimeout(2000)
    await expect(target.locator('.mod-badge')).toBeVisible({ timeout: 8000 })
  })

  test('host can remove a guest', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.kick-btn').isVisible().catch(() => false)) {
        target = item; break
      }
    }
    expect(target, 'No Remove button found — guests not in panel').not.toBeNull()

    // Handle native confirm() dialog if the UI uses one
    hostPage.once('dialog', d => d.accept().catch(() => {}))
    await target.locator('.kick-btn').click()

    // Also click any in-page confirmation modal that may appear
    const confirmBtn = hostPage.locator('button').filter({ hasText: /confirm|yes|remove|kick/i })
    if (await confirmBtn.isVisible({ timeout: 2000 }).catch(() => false)) await confirmBtn.click()

    // Wait for LiveKit to propagate removal (up to 15s)
    await expect(hostPage.locator('.participant-item')).toHaveCount(count - 1, { timeout: 15000 })
  })

  test('host can lock the room then unlock it', async () => {
    const lockBtn = hostPage.locator('#btn-lock')
    await expect(lockBtn).toBeVisible({ timeout: 5000 })
    await lockBtn.click()
    await hostPage.waitForTimeout(1500)
    const lockedVal = await lockBtn.getAttribute('data-locked').catch(() => null)
    if (lockedVal !== null) expect(['true', '1', 'locked']).toContain(lockedVal)
    await lockBtn.click()
    await hostPage.waitForTimeout(1500)
    const unlockedVal = await lockBtn.getAttribute('data-locked').catch(() => null)
    if (unlockedVal !== null) expect(['false', '0', '']).toContain(unlockedVal)
  })

  test('share screen button is visible for host', async () => {
    await expect(hostPage.locator('#btn-screen')).toBeVisible()
  })

  test('Mute All button is not visible to guests', async () => {
    expect(guests).toHaveLength(3)
    for (const { page, name } of guests) {
      const visible = await page.locator('#btn-mute-all').isVisible().catch(() => false)
      expect(visible, `${name} should not see Mute All`).toBe(false)
    }
  })
})
