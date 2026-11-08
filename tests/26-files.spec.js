// 26 - File sharing in meetings: a guest shares a 3 MB file from the chat (📎), the host sees it and downloads
// the same bytes; outsiders and wrong keys get nothing; programs can be shared (with a caution); the host can switch sharing off;
// the file is gone as soon as the meeting ends.
const { test, expect, request } = require('./guard')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host, guest, fileId
const SIZE = 3 * 1024 * 1024                                      // above nginx's normal 1 MB limit on purpose
const data = Buffer.alloc(SIZE, 0); for (let i = 0; i < SIZE; i++) data[i] = (i * 31 + 7) & 255
const asPage = (page, method, path, body, headers) => page.evaluate(([m, u, b, h]) => fetch(u, { method: m, headers: h || {}, body: b }).then(r => r.status), [method, path, body, headers])

test.describe.serial('26 - File sharing', () => {
  test.setTimeout(180000)
  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'files'))
    host = await H.joinAsHost(meetingId)
    guest = await H.joinAsGuest(roomUuid, 'Guest Files')
    await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(2, { timeout: 30000 })
    for (const p of [host.page, guest.page]) { await H.openPanel(p); await p.evaluate(() => window.TenetPeople && window.TenetPeople.setTab('chat')) }
  })
  test.afterAll(async () => {
    if (api) { await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {}); await api.close().catch(() => {}) }
    for (const p of [guest, host]) if (p) await p.browser.close().catch(() => {})
  })

  test('guest shares a 3 MB file; the host downloads exactly that file', async () => {
    await expect(guest.page.locator('#tf-btn')).toBeVisible({ timeout: 15000 })
    await guest.page.setInputFiles('#tf-file', { name: 'Quarterly plan ü.pdf', mimeType: 'application/pdf', buffer: data })
    const card = host.page.locator('.tf-card', { hasText: 'Quarterly plan ü.pdf' })
    await expect(card).toBeVisible({ timeout: 30000 })
    await expect(card).toContainText('3.0 MB')
    fileId = await card.getAttribute('data-file')
    const [dl] = await Promise.all([host.page.waitForEvent('download'), card.locator('button').click()])
    expect(dl.suggestedFilename()).toBe('Quarterly plan ü.pdf')
    const got = require('fs').readFileSync(await dl.path())
    expect(got.length).toBe(SIZE)
    expect(got.equals(data), 'same bytes').toBe(true)
    await expect(guest.page.locator('.tf-card', { hasText: 'Quarterly plan ü.pdf' })).toHaveCount(1)   // uploader sees it once
    await H.expectHealthy(host, guest)
  })

  test('outsiders get nothing; programs can be shared, with a caution', async () => {
    const out = await request.newContext({ ignoreHTTPSErrors: true })
    try {
      const B = `${H.BASE_URL}/api/meetings/${meetingId}/files`
      expect((await out.get(`${B}/${fileId}`)).status(), 'download without key').toBe(403)
      expect((await out.get(B)).status(), 'list without key').toBe(403)
      expect((await out.post(B, { headers: { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'x.txt' }, data: Buffer.from('x') })).status(), 'upload without key').toBe(403)
    } finally { await out.dispose() }
    await guest.page.setInputFiles('#tf-file', { name: 'tool-setup.exe', mimeType: 'application/octet-stream', buffer: Buffer.from('MZ test program') })
    const card = host.page.locator('.tf-card', { hasText: 'tool-setup.exe' })
    await expect(card, 'program shared').toBeVisible({ timeout: 20000 })
    await expect(card.locator('.tf-warn'), 'caution shown to others').toContainText('open only if you trust')
  })

  test('host switches file sharing off and on', async () => {
    await H.openHostSettings(host.page)
    await expect(host.page.locator('#tf-switch')).toBeVisible()
    await host.page.locator('#tf-switch input').uncheck()
    await expect(guest.page.locator('#tf-btn')).toBeHidden({ timeout: 10000 })
    expect(await asPage(guest.page, 'POST', `/api/meetings/${meetingId}/files`, 'hi', { 'Content-Type': 'application/octet-stream', 'X-File-Name': 'a.txt' }), 'upload while off').toBe(403)
    await expect(guest.page.locator('#tf-switch')).toBeHidden()                 // guests cannot switch it
    await host.page.locator('#tf-switch input').check()
    await expect(guest.page.locator('#tf-btn')).toBeVisible({ timeout: 10000 })
  })

  test('the file is gone as soon as the meeting ends', async () => {
    expect((await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`)).status()).toBeLessThan(300)
    expect((await api.request.get(`${H.BASE_URL}/api/meetings/${meetingId}/files/${fileId}`)).status()).toBe(404)
  })
})
