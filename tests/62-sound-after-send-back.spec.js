// 62 - Sound still flows after "let in -> send back -> let in again" (9 Nov).
// Found by the error guard: during test 42 the media library said "Tried to add a track for a participant, that's
// not present" after a guest was let in again. Test 42 checks the lists, not the sound. Here we check that, after
// each let-in, the host really receives the guest's microphone and the guest really receives the host's, the same
// as after the first let-in.
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

const RUN = Date.now().toString(36)
const NAME = 'Guest Sona'
let meetingId, roomUuid, api, host, g

const waitRow = n => host.page.locator('#wr-box .wr-row[data-wid]', { hasText: n })
const inRow = n => host.page.locator('#wr-box .wr-row[data-identity]', { hasText: n })

// What one page receives from a person (matched by display name): 'ok' = their microphone arrives and is live
const hears = (page, who) => page.evaluate(n => {
  const r = window.__tenetRoom; if (!r || String(r.state) !== 'connected') return 'not connected'
  const p = [...r.remoteParticipants.values()].find(x => String(x.name || x.identity || '').includes(n))
  if (!p) return 'not in the room'
  const a = [...p.trackPublications.values()].find(t => t.kind === 'audio')
  if (!a) return 'no microphone published'
  if (!a.isSubscribed || !a.track) return 'microphone not received'
  const mt = a.track.mediaStreamTrack
  return mt && mt.readyState === 'live' ? 'ok' : 'microphone ' + (mt ? mt.readyState : 'missing')
}, who).catch(() => 'page busy')

async function letIn () {
  await expect(waitRow(NAME)).toBeVisible({ timeout: 15000 })
  await waitRow(NAME).locator('.wr-admit').click()
  await expect(g.page).toHaveURL(/\/meeting\//, { timeout: 15000 })
  await H.finishJoin(g.page, NAME)
}
async function sendBack () {
  await expect(inRow(NAME)).toBeVisible({ timeout: 15000 })
  await inRow(NAME).locator('.wr-back').click()
  await expect(g.page).toHaveURL(/\/wait\//, { timeout: 15000 })
  await expect.poll(() => hears(host.page, NAME), { message: 'host no longer has the guest in the room', timeout: 15000 }).toBe('not in the room')
}
async function both () { return { hostHearsGuest: await hears(host.page, NAME), guestHearsHost: await hears(g.page, H.HOST_DISPLAY) } }

test.describe.serial('62 - Sound after let in, send back, let in again', () => {
  test.setTimeout(180000)
  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'snd-back'))
    const r = await api.request.patch(`${H.BASE_URL}/api/meetings/${meetingId}`, { data: { waiting_room: 1 } })
    expect(r.ok(), 'waiting room on').toBe(true)
    host = await H.joinAsHost(meetingId)
  })
  test.afterAll(async () => {
    for (const x of [g, host]) if (x) await x.browser.close().catch(() => {})
    if (api) { await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {}); await api.close().catch(() => {}) }
  })

  test('first let in: both hear each other', async () => {
    g = await H.openAsGuest(roomUuid, NAME, H.DESKTOP, ('t62-sona-' + RUN).slice(0, 64))
    expect(g.body.lobby, 'guest waits').toBe(true)
    await letIn()
    await expect.poll(both, { message: 'after the first let in', timeout: 20000 }).toEqual({ hostHearsGuest: 'ok', guestHearsHost: 'ok' })
  })

  for (const round of [1, 2]) {
    test('send back and let in again (' + round + '): both still hear each other', async () => {
      await sendBack()
      await letIn()
      await expect.poll(both, { message: 'after letting in again, round ' + round, timeout: 20000 }).toEqual({ hostHearsGuest: 'ok', guestHearsHost: 'ok' })
      await g.page.waitForTimeout(3000)                                   // and it stays that way
      expect(await both(), 'still fine 3 s later, round ' + round).toEqual({ hostHearsGuest: 'ok', guestHearsHost: 'ok' })
    })
  }
})
