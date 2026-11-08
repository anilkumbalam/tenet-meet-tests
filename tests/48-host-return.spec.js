// 48 - The host hands over, leaves, and comes back: still "host", and the co-host they chose stays co-host (bug A, 7 Nov).
// Seen once on 6 Nov: after coming back the host was labelled "co-host" and the chosen guest lost the label.
// Repeated on purpose (Rejoin button twice, then a fresh join as from the dashboard), because it did not happen every time.
// Each round checks the host's page, the guest's page and the server, right after the return and again one status cycle later.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

let m = {}, host, guest

const badges = page => page.evaluate(() => {
  const o = {}
  document.querySelectorAll('.participant-item[data-identity]').forEach(r => {
    const b = r.querySelector('.mod-badge'); o[r.dataset.identity] = b ? b.textContent.trim() : ''
  })
  return o
})
const server = async () => { const s = await H.meetingStatus(m.api, m.meetingId); return { email: s.moderator_email || null, identity: s.moderator_identity || null, pid: s.moderator_pid || null, auto: s.moderator_auto } }
const ended = page => page.evaluate(() => { const e = document.getElementById('ended-screen'); return e && e.classList.contains('show') ? (e.querySelector('h2') || {}).textContent : 'still in' })

async function leaveWithHandOver (page, first) {
  await page.locator('#btn-end').click()
  await page.locator('#tb-leave-only').click()
  await expect(page.locator('#hl-dialog')).toBeVisible({ timeout: 10000 })
  if (first) await page.locator('#hl-dialog input[name="hl-who"]').first().check()
  else await expect(page.locator('#hl-dialog')).toContainText('is co-host and will take over')
  await page.locator('#hl-go').click()
  await expect.poll(() => ended(page), { timeout: 10000 }).toBe('You left the meeting')
}

// 'ok' or what is wrong, as the host's page, the guest's page and the server see it
async function roles (hostId, guestId) {
  const h = await badges(host.page), g = await badges(guest.page), s = await server()
  const bad = []
  if (h[hostId] !== 'host') bad.push(`host page: host is "${h[hostId]}"`)
  if (h[guestId] !== 'co-host') bad.push(`host page: guest is "${h[guestId]}"`)
  if (g[hostId] !== 'host') bad.push(`guest page: host is "${g[hostId]}"`)
  if (g[guestId] !== 'co-host') bad.push(`guest page: guest is "${g[guestId]}"`)
  if (s.identity !== guestId) bad.push(`server: co-host is ${JSON.stringify(s)}`)
  return bad.length ? bad.join('; ') : 'ok'
}

test.describe.serial('48 - Host returns after a hand-over', () => {

  test.setTimeout(420000)

  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'host-return')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Keeps')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (m.meetingId && m.api) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m.api) await m.api.close().catch(() => {})
  })

  for (const round of [1, 2, 3]) {
    const how = round < 3 ? 'Rejoin button' : 'a fresh join (as from the dashboard)'
    test(`round ${round}: hand over, leave, come back by ${how}: host is "host", the guest stays "co-host"`, async () => {
      await leaveWithHandOver(host.page, round === 1)
      const guestId = (await server()).identity
      expect(guestId, 'the server has the guest as co-host after the hand-over').toMatch(/Guest Keeps_guest_\d+$/)
      await expect(guest.page.locator('#btn-mute-all')).toBeVisible({ timeout: 15000 })

      if (round < 3) {
        await host.page.locator('#fv-rejoin').click()
        await H.finishJoin(host.page, 'Host back')
      } else {
        await host.browser.close().catch(() => {})
        host = await H.joinAsHost(m.meetingId)
      }
      await expect.poll(() => H.roomState(host.page), { timeout: 30000 }).toBe('connected')
      const hostId = await host.page.evaluate(() => window.__tenetRoom && window.__tenetRoom.localParticipant.identity)
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await H.openPanel(host.page); await H.openPanel(guest.page)

      await expect.poll(() => roles(hostId, guestId), { timeout: 20000 }).toBe('ok')
      await host.page.waitForTimeout(17000)                       // one status check later (every 15 s): still right?
      const later = await roles(hostId, guestId)
      console.log(`[48] round ${round} (${how}): ${later} | server ${JSON.stringify(await server())}`)
      expect(later).toBe('ok')
      await expect(host.page.locator('#btn-mute-all')).toBeVisible()          // the host has host powers
      await expect(guest.page.locator('#btn-mute-all')).toBeVisible()         // the co-host keeps theirs
    })
  }

  test('round 4 (the 6 Nov case): the co-host tab closes while the host is in: the host is NOT put in the co-host slot, stays host', async () => {
    const other = await H.joinAsGuest(m.roomUuid, 'Guest Other')
    try {
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
      const hostId = await host.page.evaluate(() => window.__tenetRoom.localParticipant.identity)
      await guest.page.goto('about:blank')                                   // the co-host's tab closes -> leave is sent
      await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
      await expect.poll(async () => (await server()).identity, { timeout: 20000 }).toBeNull()
      await host.page.waitForTimeout(17000)                                 // one status check later
      const s = await server(), h = await badges(host.page)
      console.log(`[48] round 4: server ${JSON.stringify(s)} | host page ${JSON.stringify(h)}`)
      expect(s.email, 'the host was put in the co-host slot').not.toBe(hostId)
      expect(s.identity).toBeNull()
      expect(h[hostId]).toBe('host')
      expect(Object.values(h).filter(b => b === 'co-host'), 'nobody shown as co-host').toEqual([])
      await expect(host.page.locator('#btn-mute-all')).toBeVisible()        // the host keeps full powers
    } finally { await other.browser.close().catch(() => {}) }
  })
})
