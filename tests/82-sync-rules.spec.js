// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

/*
  82 - What a page shows matches what is really happening (18 Nov)

    1. The host mutes a guest: the guest's OWN mic button shows it (not only the host's view, see 08 and 35)
    2. A guest made co-host reloads the page: still co-host, with the powers to match (14 covers the host reloading)
    3. One screen share at a time, enforced by the server: a second share started around the page's own check
       (12 covers the page's check) is stopped; when two start together, exactly one is left
*/

const sharesSeenBy = page => page.evaluate(() => {
  let n = 0
  const r = window.__tenetRoom
  if (r) r.remoteParticipants.forEach(p => p.trackPublications.forEach(t => { if (t.source === 'screen_share' && !t.isMuted) n++ }))
  return n
})
const startShareAroundThePage = page => page.evaluate(() => window.__tenetRoom.localParticipant.setScreenShareEnabled(true).then(() => 'ok', e => 'error: ' + e.message))
const pidOf = page => page.evaluate(() => new URLSearchParams(window.__tenetParams || location.search).get('pid'))

async function rowOf (hostPage, name) {
  await H.openPanel(hostPage)
  const row = hostPage.locator('.participant-item', { hasText: name }).first()
  await expect(row, name + ' listed for the host').toBeVisible({ timeout: 15000 })
  return row
}

test.describe('82 - pages match reality', () => {
  test.describe.configure({ mode: 'serial' })
  let m, host, ann, ben

  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 't82')
    host = await H.joinAsHost(m.meetingId)
    ann = await H.joinAsGuest(m.roomUuid, 'T82 Ann')
    ben = await H.joinAsGuest(m.roomUuid, 'T82 Ben')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(3, { timeout: 30000 })
  })
  test.afterAll(async () => {
    for (const p of [host, ann, ben]) if (p) await p.browser.close().catch(() => {})
    if (m) { await m.api.request.delete(`${H.BASE_URL}/api/meetings/${m.meetingId}`).catch(() => {}); await m.api.close().catch(() => {}) }
  })

  test('1. the host mutes a guest: the guest\'s own mic button shows muted', async () => {
    await expect(ann.page.locator('#btn-mic'), 'mic on to start with').not.toHaveClass(/\boff\b/, { timeout: 15000 })
    const row = await rowOf(host.page, 'T82 Ann')
    await H.openRowMenu(row)
    await row.locator('.p-mod-btn').filter({ hasText: /^Mute$/ }).click()
    // First: did the host's mute really reach Ann? Then: does her own button show it?
    await expect.poll(() => ann.page.evaluate(() => {
      let muted = null
      window.__tenetRoom.localParticipant.trackPublications.forEach(t => { if (t.source === 'microphone') muted = t.isMuted })
      return muted
    }), { message: 'the host\'s mute really reached Ann', timeout: 10000 }).toBe(true)
    await expect(ann.page.locator('#btn-mic'), 'the guest\'s own button follows the host\'s mute').toHaveClass(/\boff\b/, { timeout: 10000 })
  })

  test('2. a guest made co-host reloads the page: still co-host, powers intact', async () => {
    const row = await rowOf(host.page, 'T82 Ben')
    await H.openRowMenu(row)
    await row.locator('.p-mod-btn', { hasText: 'Make co-host' }).dispatchEvent('click')
    const pid = await pidOf(ben.page)
    await expect.poll(async () => String((await H.meetingStatus(m.api, m.meetingId)).moderator_pid || ''), { message: 'Ben is co-host', timeout: 10000 }).toBe(String(pid))

    await ben.page.reload({ waitUntil: 'domcontentloaded' })
    await H.finishJoin(ben.page, 'T82 Ben')
    await expect.poll(() => H.roomState(ben.page), { message: 'Ben back in after the reload', timeout: 30000 }).toBe('connected')
    expect(await pidOf(ben.page), 'same participant after the reload').toBe(pid)
    expect(String((await H.meetingStatus(m.api, m.meetingId)).moderator_pid || ''), 'still co-host on the server').toBe(String(pid))

    // A co-host power, used from Ben's own page (his participant key is added to the call): mute Ann
    const annIdentity = await ann.page.evaluate(() => window.__tenetRoom.localParticipant.identity)
    const status = await ben.page.evaluate(([mid, who]) => fetch('/api/meetings/' + mid + '/mute/' + encodeURIComponent(who), { method: 'POST' }).then(r => r.status), [m.meetingId, annIdentity])
    expect(status, 'the co-host can still mute others after the reload').toBe(200)
  })

  test('3a. a second screen share started around the page is stopped by the server', async () => {
    await ann.page.locator('#btn-screen').click()
    await expect.poll(() => sharesSeenBy(host.page), { message: 'Ann is sharing', timeout: 20000 }).toBe(1)
    expect(await startShareAroundThePage(ben.page), 'Ben starts a share without the page\'s check').toBe('ok')
    await expect.poll(() => sharesSeenBy(host.page), { message: 'back to one share', timeout: 15000 }).toBe(1)
    await expect.poll(() => H.isSharing(ann.page), { message: 'Ann, the first, is still sharing', timeout: 5000 }).toBe(true)
    await ann.page.evaluate(() => window.__tenetRoom.localParticipant.setScreenShareEnabled(false))
    await ben.page.evaluate(() => window.__tenetRoom.localParticipant.setScreenShareEnabled(false))
    await expect.poll(() => sharesSeenBy(host.page), { timeout: 15000 }).toBe(0)
  })

  test('3b. two shares started at the same moment: exactly one is left', async () => {
    const [a, b] = await Promise.all([startShareAroundThePage(ann.page), startShareAroundThePage(ben.page)])
    expect([a, b]).toEqual(['ok', 'ok'])
    await expect.poll(() => sharesSeenBy(host.page), { message: 'one share left', timeout: 15000 }).toBe(1)
    await host.page.waitForTimeout(4000)
    expect(await sharesSeenBy(host.page), 'and it stays one').toBe(1)
  })
})
