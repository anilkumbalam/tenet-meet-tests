// 50 - Panel tidy-up (7 Nov, C2 + counts: panel-tidy.css / panel-tidy.js).
//  - One people count: the number on the People & Chat button follows the people in the meeting; the top-bar 👥 pill
//    and the number after "Participants" are hidden.
//  - Host settings: both checkboxes start in the same column; "1 GB" stays on one line.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let m = {}, host, guest

const badge = page => page.evaluate(() => { const b = document.getElementById('pc-badge'); return b && !b.hidden && b.offsetParent !== null ? b.textContent.trim() : 'none' })

test.describe.serial('50 - Panel tidy-up', () => {

  test.setTimeout(150000)

  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'panel-tidy')
    host = await H.joinAsHost(m.meetingId)
  })

  test.afterAll(async () => {
    if (m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m.api) await m.api.close().catch(() => {})
  })

  test('one count: People & Chat shows 1, then 2 when a guest joins, 1 again when they leave; the other counts are hidden', async () => {
    const p = host.page
    await expect.poll(() => badge(p), { timeout: 10000 }).toBe('1')
    await expect(p.locator('#p-count-badge')).toBeHidden()
    await expect(p.locator('#people-count')).toBeHidden()
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Count')
    await expect.poll(() => badge(p), { timeout: 30000 }).toBe('2')
    await expect.poll(() => badge(guest.page), { timeout: 15000 }).toBe('2')                 // the guest sees it too
    await guest.page.locator('#btn-end').click()
    await expect.poll(() => badge(p), { timeout: 30000 }).toBe('1')
  })

  test('Host settings: the two checkboxes line up, "1 GB" on one line', async () => {
    const p = host.page
    await H.openPanel(p)
    await p.locator('#hs-btn').click()
    await expect(p.locator('#hs-pop')).toBeVisible({ timeout: 5000 })
    const r = await p.evaluate(() => {
      const boxes = [...document.querySelectorAll('#hs-pop .hs-slot input[type="checkbox"]')].filter(b => b.offsetParent !== null || b.getClientRects().length)
      const xs = boxes.map(b => Math.round(b.getBoundingClientRect().left))
      const hint = [...document.querySelectorAll('#hs-pop .hs-hint')].map(h => h.textContent).find(t => /GB/.test(t)) || ''
      return { xs, gbTogether: /1 GB/.test(hint) }
    })
    console.log('[50] checkbox left edges', JSON.stringify(r))
    expect(r.xs.length, 'checkboxes found').toBeGreaterThanOrEqual(2)
    expect(Math.max(...r.xs) - Math.min(...r.xs), 'checkboxes in one column').toBeLessThanOrEqual(1)
    expect(r.gbTogether).toBe(true)
    await p.keyboard.press('Escape')
  })
})
