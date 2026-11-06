// 45 - Grid with an odd count, and one colour per person (item 5, 6 Nov).
//  - Grid view: every tile has the same size; a last row that is not full sits in the middle.
//  - The avatar colour of each person is the same on their tile and in the People list.
// Checked on the host's page with 3, 5 and 7 people (desktop), and with 7 on a phone-sized window.
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, host
const guests = []

// 'ok', or what is wrong
const layout = (page, id = 'video-grid') => page.evaluate(id => {
  const g = document.getElementById(id); if (!g) return 'no grid'
  const tiles = [...g.querySelectorAll('.video-tile')].filter(t => t.offsetParent !== null)
  if (!tiles.length) return 'no tiles'
  const r = tiles.map(t => t.getBoundingClientRect())
  const w = r[0].width, h = r[0].height
  if (r.some(x => Math.abs(x.width - w) > 2 || Math.abs(x.height - h) > 2)) return 'tiles differ in size: ' + r.map(x => Math.round(x.width) + 'x' + Math.round(x.height)).join(' ')
  const rows = {}
  r.forEach(x => { const k = Math.round(x.top / 4); (rows[k] = rows[k] || []).push(x) })
  const list = Object.keys(rows).sort((a, b) => a - b).map(k => rows[k])
  const full = list[0].length, last = list[list.length - 1]
  if (last.length === full) return 'ok'
  const gr = g.getBoundingClientRect()
  const firstRow = (list[0][0].left + list[0][full - 1].right) / 2
  const mid = (Math.min(...last.map(x => x.left)) + Math.max(...last.map(x => x.right))) / 2
  return Math.abs(mid - firstRow) <= 3 ? 'ok' : 'last row not centred: ' + Math.round(mid) + ' vs ' + Math.round(firstRow) + ' (grid ' + Math.round(gr.left) + '-' + Math.round(gr.right) + ')'
}, id)

// 'ok', or the people whose colours differ
const colours = page => page.evaluate(() => {
  const bad = []
  let n = 0
  document.querySelectorAll('.participant-item[data-identity]').forEach(row => {
    const id = row.dataset.identity
    const tile = [...document.querySelectorAll('#video-grid .video-tile')].find(t => t.dataset.identity === id)
    const ta = tile && tile.querySelector('.tile-avatar'), pa = row.querySelector('.p-avatar')
    if (!ta || !pa) return
    n++
    const a = getComputedStyle(ta).backgroundColor, b = getComputedStyle(pa).backgroundColor
    if (a !== b) bad.push(id + ': tile ' + a + ', list ' + b)
  })
  return n === 0 ? 'nothing compared' : (bad.length ? bad.join('; ') : 'ok')
})

async function grow (n) {
  while (guests.length + 1 < n) guests.push(await H.joinAsGuest(roomUuid, 'Grid ' + String.fromCharCode(65 + guests.length)))
  await expect(host.page.locator('#video-grid .video-tile')).toHaveCount(n, { timeout: 30000 })
}

test.describe.serial('45 - Grid and avatar colours', () => {

  test.setTimeout(300000)

  test.beforeAll(async ({ browser }) => {
    ({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'grid-test'))
    host = await H.joinAsHost(meetingId)
  })

  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    for (const p of [host, ...guests]) if (p) await p.browser.close().catch(() => {})
    if (api) await api.close().catch(() => {})
  })

  for (const n of [3, 5, 7]) {
    test(`${n} people: same tile size, last row in the middle, same colour on tile and in People`, async () => {
      await grow(n)
      await expect.poll(() => layout(host.page), { timeout: 10000 }).toBe('ok')
      await H.openPanel(host.page)
      await expect.poll(() => colours(host.page), { timeout: 10000 }).toBe('ok')
    })
  }

  test('7 people on a phone held upright (3 x 3): the seventh tile is in the middle', async () => {
    const open = await host.page.locator('#right-panel').getAttribute('class').then(c => !(c || '').includes('hidden')).catch(() => false)
    if (open) { await host.page.locator('#btn-panel').click(); await host.page.waitForTimeout(500) }   // on a phone the panel is a full page over the grid
    const before = host.page.viewportSize()
    await host.page.setViewportSize({ width: 390, height: 844 })
    try {
      await expect.poll(() => layout(host.page), { timeout: 10000 }).toBe('ok')
      const lone = await host.page.evaluate(() => {
        const t = [...document.querySelectorAll('#video-grid .video-tile')].filter(x => x.offsetParent !== null).pop()
        return Boolean(t && t.dataset.gc)
      })
      expect(lone, 'the last tile was moved to the middle').toBe(true)
    } finally { if (before) await host.page.setViewportSize(before) }
  })

  test('Speaker view (chosen from the View menu): no tile is moved, the side strip shows its tiles whole', async () => {
    const p = host.page
    await p.locator('#btn-view').click(); await p.locator('#vbtn-speaker').click()
    await expect.poll(() => p.evaluate(() => document.body.classList.contains('view-speaker')), { timeout: 5000 }).toBe(true)
    await p.waitForTimeout(800)
    expect(await p.evaluate(() => document.querySelectorAll('.video-tile[data-gc]').length), 'tiles still moved sideways').toBe(0)
    const strip = await p.evaluate(() => { const s = document.getElementById('sidebar-strip'); return s ? { n: s.querySelectorAll('.video-tile').length, over: s.scrollWidth - s.clientWidth } : null })
    expect(strip && strip.n, 'tiles in the side strip').toBeGreaterThan(0)
    expect(strip.over, 'side strip wider than its tiles fit (scroll bar)').toBeLessThanOrEqual(1)
    await p.locator('#btn-view').click(); await p.locator('#vbtn-grid').click()                     // back to Grid: centred again
    await expect.poll(() => layout(p), { timeout: 10000 }).toBe('ok')
  })
  test('Strip view with 3 people pinned (2 + 1): the third is in the middle', async () => {
    const p = host.page
    await p.locator('#btn-view').click(); await p.locator('#vbtn-strip').click()
    await expect.poll(() => p.evaluate(() => document.body.classList.contains('view-strip')), { timeout: 5000 }).toBe(true)
    const pinned = () => p.evaluate(() => document.querySelectorAll('#strip-grid .video-tile').length)
    for (let i = 0; i < 8 && (await pinned()) < 3; i++) { await p.locator('#strip-bar .video-tile').first().click(); await p.waitForTimeout(400) }
    for (let i = 0; i < 8 && (await pinned()) > 3; i++) { await p.locator('#strip-grid .video-tile').last().click(); await p.waitForTimeout(400) }
    expect(await pinned(), 'people pinned').toBe(3)
    await expect.poll(() => layout(p, 'strip-grid'), { timeout: 10000 }).toBe('ok')
    expect(await p.evaluate(() => document.querySelectorAll('#strip-grid .video-tile[data-gc]').length), 'the third tile was moved to the middle').toBe(1)
    await p.locator('#btn-view').click(); await p.locator('#vbtn-grid').click()
    await expect.poll(() => layout(p), { timeout: 10000 }).toBe('ok')
  })
})
