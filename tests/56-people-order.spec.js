// 56 - People list order (7 Nov, people-order.js): you, the host, the co-host, then everyone else A to Z.
// The same for everyone (apart from "you" on top), and a rejoin moves nobody.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'

// The list as one person sees it: "YOU", "HOST", or the guest's first name.
const order = page => page.evaluate(host => Array.from(document.querySelectorAll('#participants-list .participant-item')).map(i => {
  const n = (i.querySelector('.p-name') || {}).textContent || ''
  if (/\(you\)/.test(n)) return 'YOU'
  if (i.dataset.identity === host) return 'HOST'
  return n.trim().split(/\s+/)[0]
}).join(','), HOST)

test.describe('56 - People list order', () => {
  test.setTimeout(240000)

  test('you, host, co-host, then A to Z; the same for everyone; a rejoin moves nobody', async ({ browser }) => {
    let m, host, zed, amy, mia
    try {
      m = await H.createMeeting(browser, 'people-order')
      host = await H.joinAsHost(m.meetingId)
      zed = await H.joinAsGuest(m.roomUuid, 'Zed Guest')                 // joins first, sorts last
      amy = await H.joinAsGuest(m.roomUuid, 'Amy Guest')
      mia = await H.joinAsGuest(m.roomUuid, 'Mia Guest')
      for (const p of [host, zed, amy, mia]) { await expect(p.page.locator('#video-grid .video-tile')).toHaveCount(4, { timeout: 40000 }); await H.openPanel(p.page) }

      // no co-host yet: A to Z after you and the host
      await expect.poll(() => order(host.page), { timeout: 15000 }).toBe('YOU,Amy,Mia,Zed')
      await expect.poll(() => order(zed.page), { timeout: 15000 }).toBe('YOU,HOST,Amy,Mia')
      await expect.poll(() => order(amy.page), { timeout: 15000 }).toBe('YOU,HOST,Mia,Zed')

      // Mia becomes co-host: she moves up to just after the host
      const row = host.page.locator('.participant-item').filter({ hasText: 'Mia Guest' })
      await H.openRowMenu(row)
      await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).dispatchEvent('click')
      await expect.poll(() => order(host.page), { timeout: 15000 }).toBe('YOU,Mia,Amy,Zed')
      await expect.poll(() => order(zed.page), { timeout: 15000 }).toBe('YOU,HOST,Mia,Amy')
      await expect.poll(() => order(amy.page), { timeout: 15000 }).toBe('YOU,HOST,Mia,Zed')
      await expect.poll(() => order(mia.page), { timeout: 15000 }).toBe('YOU,HOST,Amy,Zed')

      // Amy leaves and comes back: she is back in the same place, not at the bottom
      await amy.browser.close(); amy = null
      await expect.poll(() => order(zed.page), { timeout: 30000 }).toBe('YOU,HOST,Mia')
      amy = await H.joinAsGuest(m.roomUuid, 'Amy Guest')
      await expect.poll(() => order(zed.page), { timeout: 40000 }).toBe('YOU,HOST,Mia,Amy')
      await expect.poll(() => order(host.page), { timeout: 15000 }).toBe('YOU,Mia,Amy,Zed')
    } finally {
      if (m && m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
      for (const p of [host, zed, amy, mia]) if (p) await p.browser.close().catch(() => {})
      if (m && m.api) await m.api.close().catch(() => {})
    }
  })
})
