// 34 - v4 toolbar (redesign stage 1): mic/camera/share on the left, View menu + People & chat + Copy link + Lock in
// the centre, one red Leave on the right. Host: Leave opens "Leave meeting" / "End meeting for everyone"; a guest
// leaves directly. The View menu switches the layout and its label follows.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

test.describe.serial('34 - v4 toolbar', () => {
  test.setTimeout(150000)
  let m, host, guest
  test.beforeAll(async ({ browser }) => {
    m = await H.createMeeting(browser, 'toolbar-v4')
    host = await H.joinAsHost(m.meetingId)
    guest = await H.joinAsGuest(m.roomUuid, 'Guest Bar')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
  })
  test.afterAll(async () => {
    if (m) await m.api.request.post(`${H.BASE_URL}/api/meetings/${m.meetingId}/cancel`).catch(() => {})
    for (const p of [host, guest]) if (p) await p.browser.close().catch(() => {})
    if (m) await m.api.close().catch(() => {})
  })

  test('three groups in order; End meeting is not on the bar', async () => {
    const where = await host.page.evaluate(() => {
      const g = id => document.getElementById(id) && document.getElementById(id).closest('.tb-group') && document.getElementById(id).closest('.tb-group').id
      return { mic: g('btn-mic'), cam: g('btn-cam'), share: g('btn-screen'), view: g('btn-view'), panel: g('btn-panel'), copy: g('btn-copy-link'), lock: g('btn-lock'), leave: g('btn-end'),
        endOnBar: Boolean(document.getElementById('btn-end-meeting').closest('#controls')),
        order: Array.from(document.querySelectorAll('#controls > .tb-group')).map(x => x.id) }
    })
    expect(where).toEqual({ mic: 'tb-left', cam: 'tb-left', share: 'tb-left', view: 'tb-center', panel: 'tb-center', copy: 'tb-center', lock: 'tb-center', leave: 'tb-right', endOnBar: false, order: ['tb-left', 'tb-center', 'tb-right'] })
    for (const id of ['#btn-mic', '#btn-cam', '#btn-view', '#btn-panel', '#btn-copy-link', '#btn-lock', '#btn-end']) expect(await H.clickable(host.page, id), id).toBe('ok')
    const a = await H.rect(host.page, '#btn-mic'), b = await H.rect(host.page, '#btn-view'), c = await H.rect(host.page, '#btn-end')
    expect(a.left < b.left && b.left < c.left, 'left, centre, right').toBe(true)
  })

  test('View menu switches the layout and the button says which', async () => {
    const p = host.page
    await p.locator('#btn-view').click()
    await expect(p.locator('#tb-view-menu')).toBeVisible()
    await p.locator('#vbtn-speaker').click()
    await expect(p.locator('#tb-view-menu')).toBeHidden()
    await expect.poll(() => p.evaluate(() => document.body.className)).toContain('view-speaker')
    await expect(p.locator('#btn-view')).toContainText('View: Speaker')
    await H.chooseView(p, '#vbtn-grid')
    await expect(p.locator('#btn-view')).toContainText('View: Grid')
  })

  test('host: Leave opens the Leave menu with End meeting; Escape closes it', async () => {
    const p = host.page
    await p.locator('#btn-end').click()
    await expect(p.locator('#tb-leave-menu')).toBeVisible()
    await expect(p.locator('#tb-leave-only')).toBeVisible()
    await expect(p.locator('#btn-end-meeting')).toBeVisible()
    await expect(p.locator('#btn-end-meeting')).toContainText('End meeting for everyone')
    await p.keyboard.press('Escape')
    await expect(p.locator('#tb-leave-menu')).toBeHidden()
    expect(await H.roomState(p), 'host still in the meeting').toBe('connected')
  })

  test('guest: no Leave menu, Leave leaves straight away', async () => {
    const p = guest.page
    expect(await H.canEnd(p)).toBe(false)
    await p.locator('#btn-end').click()
    await expect(p.locator('#tb-leave-menu')).toBeHidden()
    await expect.poll(() => H.roomState(p), { timeout: 15000 }).not.toBe('connected')
  })
})
