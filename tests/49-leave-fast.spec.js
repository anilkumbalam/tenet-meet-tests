// 49 - Leaving is immediate (7 Nov, item B: leave-fast.js). "You left the meeting" must appear within half a second
// of the click, and the leave must still reach everyone: the others see the person gone, and after a hand-over
// the new co-host gets their powers (the "host left" message still goes out).
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let m = {}, host, guest

// start the clock on the click (capture, before anything else) and stop it when the final screen shows
const arm = (page, sel) => page.evaluate(sel => {
  window.__lf0 = 0; window.__lf1 = 0
  document.addEventListener('click', e => { if (!window.__lf0 && e.target.closest && e.target.closest(sel)) window.__lf0 = performance.now() }, true)
  const e = document.getElementById('ended-screen')
  new MutationObserver(() => { if (!window.__lf1 && e.classList.contains('show')) window.__lf1 = performance.now() }).observe(e, { attributes: true, attributeFilter: ['class'] })
}, sel)
const took = page => page.evaluate(() => (window.__lf0 && window.__lf1) ? Math.round(window.__lf1 - window.__lf0) : null)
const title = page => page.evaluate(() => { const e = document.getElementById('ended-screen'); return e && e.classList.contains('show') ? (e.querySelector('h2') || {}).textContent : 'still in' })

test.describe.serial('49 - Leaving is immediate', () => {

  test.setTimeout(180000)

  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'leave-fast')
    host = await H.joinAsHost(m.meetingId)
  })

  test.afterAll(async () => {
    if (m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m.api) await m.api.close().catch(() => {})
  })

  test('guest presses Leave: "You left the meeting" within 0.5 s; the host sees them gone', async () => {
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Quick')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    await arm(guest.page, '#btn-end')
    await guest.page.locator('#btn-end').click()
    await expect.poll(() => took(guest.page), { timeout: 5000 }).not.toBeNull()
    const ms = await took(guest.page)
    console.log(`[49] guest: final screen after ${ms} ms`)
    expect(ms).toBeLessThan(500)
    expect(await title(guest.page)).toBe('You left the meeting')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(1, { timeout: 20000 })   // the leave still arrived
    await guest.browser.close().catch(() => {}); guest = null
  })

  test('host hands over and leaves: final screen within 0.5 s of "Leave meeting"; the guest still becomes co-host', async () => {
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Takes')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    const p = host.page
    await p.locator('#btn-end').click()
    await p.locator('#tb-leave-only').click()
    await expect(p.locator('#hl-dialog')).toBeVisible({ timeout: 10000 })
    await p.locator('#hl-dialog input[name="hl-who"]').first().check()
    await arm(p, '#hl-go')
    await p.locator('#hl-go').click()
    await expect.poll(() => took(p), { timeout: 5000 }).not.toBeNull()
    const ms = await took(p)
    console.log(`[49] host with hand-over: final screen after ${ms} ms`)
    expect(ms).toBeLessThan(500)
    expect(await title(p)).toBe('You left the meeting')
    await expect(p.locator('#hl-dialog')).toHaveCount(0)
    await expect(guest.page.locator('#video-grid .video-tile')).toHaveCount(1, { timeout: 20000 })  // host gone for the guest
    await expect(guest.page.locator('#btn-mute-all')).toBeVisible({ timeout: 15000 })              // and the guest is co-host
    const s = await H.meetingStatus(m.api, m.meetingId)
    expect(s.moderator_identity || '').toMatch(/Guest Takes_guest_\d+$/)
  })
})
