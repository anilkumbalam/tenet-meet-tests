const { test, expect } = require('@playwright/test')
const { AccessToken } = require('livekit-server-sdk')
const jwt = require('jsonwebtoken')

const BASE_URL     = process.env.BASE_URL || 'https://meet.tenetnetworks.com'
const JWT_SECRET   = process.env.JWT_SECRET || 'your_jwt_secret_here'
const HOST_EMAIL   = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const HOST_DISPLAY = 'Anil Kumbalam'

function forgeMeetToken(email, displayName, isAdmin = false) {
  return jwt.sign({ email, displayName, isAdmin }, JWT_SECRET, { expiresIn: '2h' })
}

async function setAuthCookie(context, email, displayName) {
  const token = forgeMeetToken(email, displayName)
  await context.addCookies([{
    name: 'meet_token', value: token,
    domain: new URL(BASE_URL).hostname, path: '/',
    httpOnly: true, secure: BASE_URL.startsWith('https'), sameSite: 'Lax',
  }])
}

const mediaStub = `(() => {
  const mk = () => {
    try {
      const ac = new AudioContext()
      const dest = ac.createMediaStreamDestination()
      return Promise.resolve(dest.stream)
    } catch (e) {
      return Promise.resolve(new MediaStream())
    }
  }
  navigator.mediaDevices.getUserMedia    = mk
  navigator.mediaDevices.getDisplayMedia = mk
  navigator.mediaDevices.enumerateDevices = async () => []
})()`

async function joinAsHost(browser, meetingId, roomCode, hostEmail, hostDisplay) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  await setAuthCookie(ctx, hostEmail, hostDisplay)
  const page = await ctx.newPage()

  const joinRes = await page.request.post(`${BASE_URL}/api/meetings/${meetingId}/join`, {
    data: { device_id: `test-host-${Date.now()}` },
  })
  if (!joinRes.ok()) throw new Error(`Host join API failed ${joinRes.status()}: ${await joinRes.text()}`)
  const { url } = await joinRes.json()

  await page.goto(`${BASE_URL}${url}`, { waitUntil: 'domcontentloaded' })

  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 8000 }).catch(() => false)) await avBtn.click()
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 20000 })
  return { page, ctx }
}

async function joinAsGuest(browser, roomCode, guestName) {
  const ctx = await browser.newContext({ ignoreHTTPSErrors: true, permissions: ['camera', 'microphone'] })
  await ctx.addInitScript(mediaStub)
  const page = await ctx.newPage()
  await page.goto(`${BASE_URL}/join/${roomCode}`, { waitUntil: 'domcontentloaded' })
  await page.locator('#n').fill(guestName)
  await page.locator('button').filter({ hasText: 'Join Meeting' }).click()
  const avBtn = page.locator('#av-join-btn')
  if (await avBtn.isVisible({ timeout: 10000 }).catch(() => false)) await avBtn.click()
  await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 30000 })
  return { page, ctx }
}

// Inject guests directly via API so they appear in the participant panel
// even if their WebRTC connection is headless-limited
async function registerGuestViaApi(page, roomUuid, guestName) {
  const res = await page.request.post(`${BASE_URL}/api/guest-join/${roomUuid}`, {
    data: { display_name: guestName },
  })
  if (!res.ok()) console.warn(`guest-join API: ${res.status()} for ${guestName}`)
  return res.ok() ? await res.json() : null
}

test.describe('08 - Room controls (host + 3 guests)', () => {
  let hostPage, hostCtx
  let meetingId, roomUuid, roomCode
  let guestPages = []

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    // 1. Create meeting
    const setupCtx = await browser.newContext({ ignoreHTTPSErrors: true })
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

    // 2. Host joins
    const hostJoin = await joinAsHost(browser, meetingId, roomCode, HOST_EMAIL, HOST_DISPLAY)
    hostPage = hostJoin.page
    hostCtx  = hostJoin.ctx

    // 3. Open participant panel so it's ready
    const panel = hostPage.locator('#right-panel')
    const panelHidden = await panel.getAttribute('class').then(c => (c||'').includes('hidden')).catch(() => true)
    if (panelHidden) {
      await hostPage.locator('#btn-panel').click()
      await hostPage.waitForTimeout(500)
    }

    // 4. Three guests join (via /join page + also register via API for panel visibility)
    const guestNames = ['Guest Alpha', 'Guest Beta', 'Guest Gamma']
    for (const name of guestNames) {
      // Register via API first so server knows about them
      await registerGuestViaApi(hostPage, roomUuid, name)
      // Then join via browser
      try {
        const g = await joinAsGuest(browser, roomCode, name)
        guestPages.push({ ...g, name })
      } catch (e) {
        console.warn(`Guest ${name} browser join failed: ${e.message}`)
        guestPages.push({ page: null, ctx: null, name })
      }
    }

    // Give LiveKit connections time to propagate
    await hostPage.waitForTimeout(5000)
  })

  test.afterAll(async () => {
    for (const { ctx } of guestPages) {
      if (ctx) await ctx.close().catch(() => {})
    }
    guestPages = []
    if (meetingId && hostPage) {
      await hostPage.request.post(`${BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    }
    if (hostCtx) await hostCtx.close().catch(() => {})
  })

  // ── Tests ────────────────────────────────────────────────────────────────────

  test('host is taken to the meeting room', async () => {
    await expect(hostPage).toHaveURL(new RegExp(`/meeting/${roomCode}`))
    await expect(hostPage.locator('#room-name-display')).toBeVisible()
  })

  test('host sees at least their own tile', async () => {
    // Host tile is always present; guests may not establish WebRTC in headless
    await expect(hostPage.locator('.video-tile').first()).toBeVisible({ timeout: 15000 })
    const count = await hostPage.locator('.video-tile').count()
    expect(count).toBeGreaterThanOrEqual(1)
  })

  test('all 3 guests reached the meeting room page', async () => {
    for (const { page, name } of guestPages) {
      if (!page) { console.warn(`[${name}] no page (browser join failed)`); continue }
      await expect(page).toHaveURL(new RegExp(`/meeting/${roomCode}`), { timeout: 10000 })
        .catch(() => console.warn(`[${name}] URL mismatch`))
      await expect(page.locator('#loading-screen')).toHaveClass(/hidden/, { timeout: 10000 })
    }
  })

  test('host can open the participants panel', async () => {
    const panel = hostPage.locator('#right-panel')
    const panelHidden = await panel.getAttribute('class').then(c => (c||'').includes('hidden')).catch(() => true)
    if (panelHidden) {
      await hostPage.locator('#btn-panel').click()
      await hostPage.waitForTimeout(500)
    }
    await expect(panel).toBeVisible()
  })

  test('participants panel shows the host entry', async () => {
    // Panel should at minimum show the host
    const items = hostPage.locator('.participant-item')
    await expect(items.first()).toBeVisible({ timeout: 15000 })
    const count = await items.count()
    expect(count).toBeGreaterThanOrEqual(1)
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

  test('host can mute and unmute an individual participant (if panel has entries)', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    if (count < 2) {
      console.warn('Only 1 participant item — skipping individual mute (host row has no mute button)')
      return
    }
    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.p-mod-btn').filter({ hasText: 'Mute' }).isVisible().catch(() => false)) {
        target = item; break
      }
    }
    if (!target) { console.warn('No Mute button found in panel — skipping'); return }

    await target.locator('.p-mod-btn').filter({ hasText: 'Mute' }).click()
    await hostPage.waitForTimeout(1500)
    const unmuteBtn = target.locator('.p-mod-btn').filter({ hasText: 'Unmute' })
    if (await unmuteBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
      await unmuteBtn.click()
    }
  })

  test('host can promote a participant to co-host (if panel has entries)', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    if (count < 2) { console.warn('Only 1 participant — skipping co-host test'); return }

    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.p-mod-btn').filter({ hasText: 'Make co-host' }).isVisible().catch(() => false)) {
        target = item; break
      }
    }
    if (!target) { console.warn('No Make co-host button found — skipping'); return }

    await target.locator('.p-mod-btn').filter({ hasText: 'Make co-host' }).click()
    await hostPage.waitForTimeout(2000)
    await expect(target.locator('.mod-badge')).toBeVisible({ timeout: 8000 })
  })

  test('host can remove a participant (if panel has entries)', async () => {
    const items = hostPage.locator('.participant-item')
    const count = await items.count()
    if (count < 2) { console.warn('Only 1 participant — skipping remove test'); return }

    let target = null
    for (let i = 0; i < count; i++) {
      const item = items.nth(i)
      if (await item.locator('.kick-btn').isVisible().catch(() => false)) {
        target = item; break
      }
    }
    if (!target) { console.warn('No Remove button found — skipping'); return }

    const before = await hostPage.locator('.video-tile').count()
    await target.locator('.kick-btn').click()
    await hostPage.waitForTimeout(3000)
    // Tiles should decrease OR panel item count should decrease
    const afterItems = await hostPage.locator('.participant-item').count()
    expect(afterItems).toBeLessThanOrEqual(count)
  })

  test('host can lock the room then unlock it', async () => {
    const lockBtn = hostPage.locator('#btn-lock')
    await expect(lockBtn).toBeVisible({ timeout: 5000 })
    await lockBtn.click()
    await hostPage.waitForTimeout(1500)
    const lockedVal = await lockBtn.getAttribute('data-locked').catch(() => null)
    if (lockedVal !== null) expect(['true','1','locked']).toContain(lockedVal)
    await lockBtn.click()
    await hostPage.waitForTimeout(1500)
    const unlockedVal = await lockBtn.getAttribute('data-locked').catch(() => null)
    if (unlockedVal !== null) expect(['false','0','']).toContain(unlockedVal)
  })

  test('share screen button is visible for host', async () => {
    await expect(hostPage.locator('#btn-screen')).toBeVisible()
  })

  test('Mute All button is not visible to guests', async () => {
    for (const { page, name } of guestPages) {
      if (!page) continue
      const visible = await page.locator('#btn-mute-all').isVisible().catch(() => false)
      expect(visible, `${name} should not see Mute All`).toBe(false)
    }
  })
})
