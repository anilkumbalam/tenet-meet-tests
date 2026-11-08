// 32 - In-meeting notices show people's names, never the internal guest ID (name_guest_<long number>) or an email
// (staff without a name: x.y@ -> X).
const { test, expect } = require('./guard')
const H = require('./meet-helpers')

test('mute, joined and left notices show the guest\'s name only', async ({ browser }) => {
  test.setTimeout(120000)
  const m = await H.createMeeting(browser, 'notice-names')
  const people = []
  try {
    const host = await H.joinAsHost(m.meetingId); people.push(host)
    const g = await H.openAsGuest(m.roomUuid, 'Guest Kim'); people.push(g)
    await H.finishJoin(g.page, 'Guest Kim')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    const text = () => host.page.evaluate(() => document.body.innerText)
    await expect.poll(text, { timeout: 10000 }).toContain('Guest Kim joined')
    const id = await host.page.evaluate(() => Array.from(window.__tenetRoom.remoteParticipants.values())[0].identity)
    expect(id, 'guest IDs carry the internal suffix').toMatch(/_guest_\d+$/)
    await host.page.evaluate(i => window.toggleMuteParticipant(i, true), id)
    await expect.poll(text, { timeout: 10000 }).toContain('Guest Kim muted')
    expect(await text(), 'no internal ID on screen').not.toMatch(/_guest_\d+/)
    expect(await host.page.evaluate(i => window.__whoName(i), id)).toBe('Guest Kim')
    expect(await host.page.evaluate(() => window.__whoName('Someone_guest_1730712345678'))).toBe('Someone')
    expect(await host.page.evaluate(() => window.__whoName('anil.kumbalam@tenetnetworks.com')), 'staff without a name: first part of the email').toBe('Anil')
    expect(await host.page.evaluate(() => window.__whoName('x@tenetnetworks.com', 'x@tenetnetworks.com')), 'an email as name is not shown').toBe('X')
  } finally {
    await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of people) await p.browser.close().catch(() => {})
    await m.api.close().catch(() => {})
  }
})
