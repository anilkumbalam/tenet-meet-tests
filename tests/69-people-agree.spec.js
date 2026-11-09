// 69 - Everyone sees the same people (9 Nov, v2). Anil saw a meeting where each device listed different people. The same
// journey runs twice, unlocked and locked, with six people (host, three desktop guests, two phone guests): join, (lock),
// host reload, a short drop, a long drop on a phone, a late joiner, someone leaving. After each step every page must be
// in the same room and list exactly the same people (in the call and in the People panel). On a mismatch the test fails
// and prints what each page saw (a page without a meeting connection reports the screen it shows instead).
// Locked: someone already in the meeting must get back in after a drop; a newcomer must be kept out until unlocked.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

const view = p => p.page.evaluate(() => {
  const r = window.__tenetRoom
  if (!r) return { state: 'no room', url: location.pathname.replace(/[0-9a-f-]{20,}/g, '<id>'), screen: ((document.querySelector('h1, h2') || {}).textContent || '').trim(), err: ((document.getElementById('err-msg') || {}).textContent || '').trim() }
  const ids = [r.localParticipant.identity, ...[...r.remoteParticipants.values()].map(x => x.identity)].sort()
  return { state: String(r.state), room: r.name, ids, panel: document.querySelectorAll('#participants-list .participant-item').length }
}).catch(e => ({ state: 'page error: ' + String(e.message).split('\n')[0] }))

async function agree (people, step, timeout = 30000) {
  let last = []
  try {
    await expect.poll(async () => {
      last = await Promise.all(people.map(async p => Object.assign({ who: p.name }, await view(p))))
      const want = JSON.stringify(last[0].ids)
      return last.every(v => v.state === 'connected' && v.room === last[0].room && JSON.stringify(v.ids) === want && v.ids.length === people.length && v.panel === people.length)
    }, { timeout, intervals: [500, 1000, 2000] }).toBe(true)
  } catch (e) {
    throw new Error('[' + step + '] pages disagree about who is in the meeting:\n' + last.map(v => '  ' + v.who + ': ' + JSON.stringify(v)).join('\n'))
  }
}
const DROPS = 'WebSocket connection to|Failed to fetch|ERR_INTERNET_DISCONNECTED'

for (const locked of [false, true]) {
  test.describe.serial('69 - Everyone sees the same people (' + (locked ? 'locked' : 'unlocked') + ', 6 people)', () => {
    test.setTimeout(300000)
    let m, host, late
    const guests = []
    const all = () => [host, ...guests, late].filter(Boolean)
    const lock = on => m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/lock`, { data: { locked: on } })
    test.beforeAll(async ({ browser }) => {
      m = await H.createMeeting(browser, locked ? 'agree-locked' : 'agree-open')
      host = await H.joinAsHost(m.meetingId)
      for (const [name, dev] of [['Guest Asha', H.DESKTOP], ['Guest Ravi', H.DESKTOP], ['Guest Meera', H.DESKTOP], ['Guest Phone One', H.PHONE], ['Guest Phone Two', H.PHONE]]) guests.push(await H.joinAsGuest(m.roomUuid, name, dev))
    })
    test.afterAll(async () => {
      for (const p of all()) await p.browser.close().catch(() => {})
      if (m) { await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {}); await m.api.close().catch(() => {}) }
    })

    test('six people join: every page lists the same six', async () => {
      await agree(all(), 'joined')
      if (locked) { expect((await lock(true)).ok(), 'host locks').toBe(true); await agree(all(), 'locked') }
    })

    test('the host reloads and rejoins: every page agrees', async () => {
      test.info().annotations.push({ type: 'guard-allow', description: DROPS })
      await host.page.reload({ waitUntil: 'domcontentloaded' })
      await H.finishJoin(host.page, 'Host')
      await agree(all(), 'host reload', 40000)
    })

    test('a 4 s network drop on a desktop guest: every page agrees', async () => {
      test.info().annotations.push({ type: 'guard-allow', description: DROPS })
      const g = guests[0]
      await g.ctx.setOffline(true); await g.page.waitForTimeout(4000); await g.ctx.setOffline(false)
      await agree(all(), 'short drop', 40000)
    })

    test('a 15 s drop on a phone: the phone gets back in by itself and every page agrees' + (locked ? ' (someone already in a locked meeting)' : ''), async () => {
      test.info().annotations.push({ type: 'guard-allow', description: DROPS + '|locked' })
      const g = guests[3]
      await g.ctx.setOffline(true); await g.page.waitForTimeout(15000); await g.ctx.setOffline(false)
      await agree(all(), 'long drop on a phone', 60000)
    })

    test(locked ? 'a newcomer is kept out while locked (lock screen), then gets in when unlocked' : 'a late guest joins: every page lists all seven', async () => {
      if (locked) {
        test.info().annotations.push({ type: 'guard-allow', description: 'guest-join|locked' })
        const out = await H.openAsGuest(m.roomUuid, 'Guest Late')
        expect(out.status, 'refused while locked').toBe(403)
        await out.browser.close()
        const b = await H.launch(); const p = await (await b.newContext({ ignoreHTTPSErrors: true })).newPage()
        await p.goto(`${H.BASE_URL}/join/${m.roomUuid}`)
        await expect(p.locator('h1'), 'the newcomer sees the lock screen').toHaveText('This meeting is locked', { timeout: 15000 })
        await b.close()
        await agree(all(), 'still six while locked')
        expect((await lock(false)).ok(), 'host unlocks').toBe(true)
      }
      late = await H.joinAsGuest(m.roomUuid, 'Guest Late')
      await agree(all(), 'late joiner')
    })

    test('one guest leaves: every page agrees on the rest', async () => {
      const g = guests.splice(1, 1)[0]
      await H.clickLeave(g.page); await g.browser.close()
      await agree(all(), 'after a leave')
      await H.expectHealthy(...all())
    })
  })
}
