// 38 - v4 guest join page and Ready to join (redesign stage 4b): name, camera preview and Join on one page (strict
// policy); the meeting then opens at once with the settings chosen there; v3 people keep the old page; the meeting
// page's own Ready to join has the new layout.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test.describe.serial('38 - v4 join page', () => {
  test.setTimeout(150000)
  let m, host, gb
  const B = H.BASE_URL
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'join-v4')
    host = await H.joinAsHost(m.meetingId)
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${B}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    if (host) await host.browser.close().catch(() => {})
    if (gb) await gb.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('the host saw the new Ready to join (round buttons on the preview, "Joining as")', async () => {
    const p = host.page
    await expect(p.locator('body')).toHaveClass(/\bpj-v4\b/)
    await expect(p.locator('#av-preview-wrap .av-controls #av-btn-mic')).toHaveCount(1)
    await expect(p.locator('#pj4-who')).toContainText('Joining as')
    await expect(p.locator('.pj4-brand')).toHaveCount(1)
  })

  test('guest: one page with name, preview and Join; joins at once with the camera off', async () => {
    gb = await H.launch('chromium')
    const ctx = await gb.newContext({ ...H.DESKTOP })
    const page = await ctx.newPage()
    const errors = []; page.on('console', x => { if (x.type() === 'error') errors.push(x.text()) })
    const resp = await page.goto(`${B}/join/${m.roomUuid}`)
    expect(resp.headers()['x-meet-ui']).toBe('4')
    const scriptSrc = (resp.headers()['content-security-policy'] || '').split(';').map(s => s.trim()).find(s => s.startsWith('script-src')) || ''
    expect(scriptSrc).toBe("script-src 'self'")
    await expect(page.locator('#jv-sub')).not.toBeEmpty({ timeout: 10000 })
    await expect(page.locator('#wv-net')).toHaveClass(/great|good|slow/, { timeout: 15000 })
    await page.fill('#n', 'Guest Jv')
    await expect(page.locator('#wv-name')).toHaveText('Joining as Guest Jv')
    await page.locator('#wv-cam').click()
    await expect(page.locator('#wv-cam')).toHaveAttribute('aria-pressed', 'false')
    await page.locator('#btn').click()
    await expect(page).toHaveURL(/\/meeting\//, { timeout: 15000 })
    await page.waitForFunction(() => window.__tenetRoom && window.__tenetRoom.state === 'connected', null, { timeout: 30000 })
    await expect(page.locator('#av-check-screen')).not.toHaveClass(/\bshow\b/)
    const t = host.page.locator('#video-grid .video-tile', { hasText: 'Guest Jv' })
    await expect(t).toBeVisible({ timeout: 30000 })
    await expect(t).toHaveClass(/ts-novideo/, { timeout: 15000 })
    await expect.poll(() => t.getAttribute('data-mic'), { timeout: 15000 }).toMatch(/^(on|speaking)$/)
    expect(errors.filter(e => /Content Security Policy|Refused to/i.test(e)), 'browser blocked something').toEqual([])
  })

  test('empty name is refused on the page; v3 people keep the old join page', async () => {
    const page = await (await gb.newContext({ ...H.DESKTOP })).newPage()
    await page.goto(`${B}/join/${m.roomUuid}`)
    await page.locator('#btn').click()
    await expect(page.locator('#err-msg')).toHaveText('Please enter your name.')
    const old = await m.api.request.get(`${B}/join/${m.roomUuid}?ui=3`)
    expect(await old.text()).toContain(`var roomUuid=${JSON.stringify(m.roomUuid)}`)
    await H.expectHealthy(host)
  })
})
