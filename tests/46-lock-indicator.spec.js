// 46 - Locked indicator (item 6, 6 Nov): lock-v4.js.
//  - Host locks: the host's Lock button turns orange "Locked"; the guest sees the "Locked" pill and a notice within seconds.
//  - The host reloads: button and pill still say Locked (taken from the server, not from memory).
//  - Host unlocks: the pill goes for everyone, the button is back to "Lock".
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host, guest

const pill = page => page.locator('#lk-pill')
const btn = page => page.evaluate(() => { const b = document.getElementById('btn-lock'); return b ? (b.classList.contains('lk-on') ? 'on' : 'off') + ' ' + (b.dataset.locked || '') + ' ' + b.textContent.trim() : 'none' })
const serverLocked = async () => (await H.meetingStatus(api, meetingId)).lock_room
const noticeText = page => page.evaluate(() => (document.getElementById('notif-area') || {}).textContent || '')

// pairs of top-bar items that overlap, or 'ok'. Items: the bar's own children and the children of its right-hand group.
const topbarClash = page => page.evaluate(() => {
  const bar = document.getElementById('topbar'); if (!bar) return 'no top bar'
  const right = bar.querySelector('.right')
  const items = [...bar.children].filter(e => e !== right).concat(right ? [...right.children] : [])
    .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden' })
  const name = e => e.id || (e.className && String(e.className).split(' ')[0]) || e.tagName
  const bad = []
  for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
    const a = items[i].getBoundingClientRect(), b = items[j].getBoundingClientRect()
    if (a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1) bad.push(name(items[i]) + ' / ' + name(items[j]))
  }
  return bad.length ? bad.join(', ') : 'ok'
})

test.describe.serial('46 - Locked indicator', () => {

  test.setTimeout(240000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'lock-test'))
    host = await H.joinAsHost(meetingId)
    guest = await H.joinAsGuest(roomUuid, 'Guest Lock')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  test('unlocked: no pill for anyone, the button says Lock', async () => {
    await expect(pill(host.page)).toBeHidden()
    await expect(pill(guest.page)).toBeHidden()
    expect(await btn(host.page)).toMatch(/^off .*Lock$/)
  })

  test('host locks: orange "Locked" button; the guest sees the pill and a notice', async () => {
    await host.page.locator('#btn-lock').click()
    await expect.poll(serverLocked, { timeout: 10000 }).toBe(true)
    await expect.poll(() => btn(host.page), { timeout: 5000 }).toMatch(/^on true .*Locked$/)
    await expect(pill(host.page)).toBeVisible()
    await expect(pill(guest.page)).toBeVisible({ timeout: 10000 })
    await expect.poll(() => noticeText(guest.page), { timeout: 5000 }).toContain("Meeting locked. New people can't join.")
    await expect(guest.page.locator('#btn-lock')).toBeHidden()                     // guests have no Lock button
  })

  test('the host reloads: still Locked after the reload, and Lock now unlocks', async () => {
    await host.page.reload({ waitUntil: 'domcontentloaded' })
    await H.finishJoin(host.page, 'Host reload')
    await expect.poll(() => H.roomState(host.page), { timeout: 30000 }).toBe('connected')
    await expect.poll(() => btn(host.page), { timeout: 30000 }).toMatch(/^on true .*Locked$/)
    await expect(pill(host.page)).toBeVisible()
  })

  test('top bar: Locked, someone waiting and an unread message fit beside the meeting name (1280, 1024, 900 px)', async () => {
    const p = host.page
    await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/waiting-room`, { data: { enabled: true } })
    const waiter = await H.openAsGuest(roomUuid, 'Guest Waiting')
    try {
      await expect.poll(() => p.evaluate(() => /waiting/i.test((document.getElementById('topbar') || {}).textContent || '')), { timeout: 20000 }).toBe(true)
      const open = await p.locator('#right-panel').getAttribute('class').then(c => !(c || '').includes('hidden')).catch(() => false)
      if (open) { await p.locator('#btn-panel').click(); await p.waitForTimeout(500) }          // unread chat shows only with the panel closed
      await H.openPanel(guest.page); await H.showChat(guest.page)                              // 9 Nov: mandatory (was best effort; the box is on the Chat tab)
      const box = guest.page.locator('#right-panel textarea:visible, #right-panel input[type="text"]:visible').first()
      await box.fill('hello from the guest', { timeout: 10000 }); await box.press('Enter')
      await expect.poll(async () => (await p.locator('#chat-messages .chat-text').allTextContents()).some(t => t.includes('hello from the guest')), { message: 'the host got the message', timeout: 15000 }).toBe(true)
      await p.waitForTimeout(2000)
      const before = p.viewportSize(), out = []
      try {
        for (const w of [1280, 1024, 900]) { await p.setViewportSize({ width: w, height: 760 }); await p.waitForTimeout(1200); out.push(w + ': ' + await topbarClash(p)) }
        const real = out.join(' | ')
        console.log('[46] meeting name as it is:', real, '|', await p.evaluate(() => (document.getElementById('topbar') || {}).innerText.replace(/\s+/g, ' ')))
        // the same with a long meeting name (shown only in this browser), to see how much room there is
        await p.evaluate(() => { const bar = document.getElementById('topbar'), right = bar.querySelector('.right'); const t = [...bar.children].filter(e => e !== right)[1]; if (t) { t.dataset.old = t.textContent; t.textContent = 'Weekly planning review with the Bangalore team' } })
        const long = []
        for (const w of [1280, 1024, 900]) { await p.setViewportSize({ width: w, height: 760 }); await p.waitForTimeout(800); long.push(w + ': ' + await topbarClash(p)) }
        console.log('[46] long meeting name:', long.join(' | '))
        await p.evaluate(() => { const bar = document.getElementById('topbar'), right = bar.querySelector('.right'); const t = [...bar.children].filter(e => e !== right)[1]; if (t && t.dataset.old != null) t.textContent = t.dataset.old })
        expect(real).toBe('1280: ok | 1024: ok | 900: ok')
      } finally { if (before) await p.setViewportSize(before) }
    } finally {
      if (waiter && waiter.browser) await waiter.browser.close().catch(() => {})
      await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/waiting-room`, { data: { enabled: false } }).catch(() => {})
    }
  })

  test('host unlocks: the pill goes for everyone, the button says Lock', async () => {
    await host.page.locator('#btn-lock').click()
    await expect.poll(serverLocked, { timeout: 10000 }).toBe(false)
    await expect.poll(() => btn(host.page), { timeout: 5000 }).toMatch(/^off false .*Lock$/)
    await expect(pill(host.page)).toBeHidden()
    await expect(pill(guest.page)).toBeHidden({ timeout: 10000 })
    await expect.poll(() => noticeText(guest.page), { timeout: 5000 }).toContain('Meeting unlocked.')
  })
})
