// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')

/*
  78 - Participant sync across views

  After every change (join, leave, host reload, late joiner), every person's
  page must agree, in every layout view (Grid / Speaker / Strip), on:
    - LiveKit itself: connected people = remote participants + me
    - tiles on the stage
    - rows in the People list, with the right names (and none who left)
    - the people count in the panel

  If a selector below is wrong, the test stops early with a message that
  names it, instead of failing as a "sync" problem.
*/

// Selectors: check against the app before the first run (see notes with this file)
const SEL = {
  views: { grid: '#vbtn-grid', speaker: '#vbtn-speaker', strip: '#vbtn-strip' },
  tile: '.video-tile',                       // one per person, wherever the view puts it
  peopleList: '#participants-list',
  peopleRow: '#participants-list .participant-item',   // one row per person in the People list
  peopleCount: '#people-count'
}

// Grid shows everyone's tile; Speaker and Strip may show fewer by design,
// but every person must still have a tile on the page (shown or hidden).
const SHOWS_ALL = { grid: true, speaker: false, strip: false }

const SYNC_TIMEOUT = 20000

async function snapshot (page) {
  return page.evaluate(sel => {
    const room = /** @type {any} */ (window).__tenetRoom
    const visible = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 }
    const list = document.querySelector(sel.peopleList)
    const countEl = document.querySelector(sel.peopleCount)
    return {
      lk: room && room.state === 'connected' ? room.remoteParticipants.size + 1 : -1,
      tilesOnPage: document.querySelectorAll(sel.tile).length,
      tilesShown: [...document.querySelectorAll(sel.tile)].filter(visible).length,
      rows: document.querySelectorAll(sel.peopleRow).length,
      listText: list ? list.textContent : null,
      countText: countEl ? (countEl.textContent || '').trim() : null
    }
  }, SEL).catch(() => null)   // page navigating (reload): try again
}

// Every person, in every view, sees exactly `names` and none of `gone`
async function expectSync (people, names, gone, label) {
  const n = names.length
  for (const p of people) {
    for (const [view, btn] of Object.entries(SEL.views)) {
      await H.chooseView(p.page, btn)
      await expect.poll(async () => {
        const s = await snapshot(p.page)
        if (!s) return 'page not ready'
        const text = s.listText || ''
        return {
          livekit: s.lk,
          tilesOnPage: s.tilesOnPage,
          tilesShownOk: SHOWS_ALL[view] ? s.tilesShown === n : s.tilesShown >= 1,
          tilesShown: s.tilesShown,   // for the report only
          rows: s.rows,
          countShowsN: s.countText !== null && new RegExp(`\\b${n}\\b`).test(s.countText),
          missing: names.filter(x => !text.includes(x)),
          stillListed: gone.filter(x => text.includes(x))
        }
      }, { message: `${label}: ${p.name}, ${view} view`, timeout: SYNC_TIMEOUT })
        .toMatchObject({ livekit: n, tilesOnPage: n, tilesShownOk: true, rows: n, countShowsN: true, missing: [], stillListed: [] })
    }
    await H.chooseView(p.page, SEL.views.grid)
  }
}

test.describe('78 - participant sync across views', () => {
  test.describe.configure({ mode: 'serial' })

  test('join, leave, host reload and late joiner: every view agrees', async ({ browser }) => {
    test.setTimeout(300000)
    const tag = Date.now().toString(36).slice(-4)
    const ANN = `T78 Ann ${tag}`, BEN = `T78 Ben ${tag}`, CY = `T78 Cy ${tag}`
    const { meetingId, roomUuid, api } = await H.createMeeting(browser, 't78')
    const people = []
    try {
      const host = await H.joinAsHost(meetingId); people.push(host)
      const ann = await H.joinAsGuest(roomUuid, ANN); people.push(ann)
      const ben = await H.joinAsGuest(roomUuid, BEN); people.push(ben)
      for (const p of people) await H.openPanel(p.page)

      // Selector check first, so a wrong selector is reported as such
      const first = await snapshot(host.page)
      expect(first && first.listText, `SEL.peopleList "${SEL.peopleList}" not found: fix it at the top of 78`).not.toBeNull()
      expect(first && first.countText, `SEL.peopleCount "${SEL.peopleCount}" not found: fix it at the top of 78`).not.toBeNull()
      await expect.poll(async () => { const s = await snapshot(host.page); return s ? s.tilesShown : 0 },
        { message: `SEL.tile "${SEL.tile}" matches no visible element: fix it at the top of 78`, timeout: SYNC_TIMEOUT }).toBeGreaterThan(0)
      await expect.poll(async () => { const s = await snapshot(host.page); return s ? s.rows : 0 },
        { message: `SEL.peopleRow "${SEL.peopleRow}" matches nothing: fix it at the top of 78`, timeout: SYNC_TIMEOUT }).toBeGreaterThan(0)

      // 1. Three people in
      await expectSync([host, ann, ben], [H.HOST_DISPLAY, ANN, BEN], [], 'three in')

      // 2. A guest leaves
      await H.clickLeave(ben.page)
      await ben.browser.close().catch(() => {})
      people.splice(people.indexOf(ben), 1)
      await expectSync([host, ann], [H.HOST_DISPLAY, ANN], [BEN], 'after Ben left')

      // 3. Host reloads the page
      await host.page.reload({ waitUntil: 'domcontentloaded' })
      await H.finishJoin(host.page, 'Host')
      await expect.poll(() => H.roomState(host.page), { message: 'host back after reload', timeout: 30000 }).toBe('connected')
      await H.openPanel(host.page)
      await expectSync([host, ann], [H.HOST_DISPLAY, ANN], [BEN], 'after host reload')

      // 4. Someone joins while the host is in Speaker view
      await H.chooseView(host.page, SEL.views.speaker)
      const cy = await H.joinAsGuest(roomUuid, CY); people.push(cy)
      await H.openPanel(cy.page)
      await expectSync([host, ann, cy], [H.HOST_DISPLAY, ANN, CY], [BEN], 'late joiner')

      await H.expectHealthy(...people)
    } finally {
      for (const p of people) await p.browser.close().catch(() => {})
      await api.request.delete(`${H.BASE_URL}/api/meetings/${meetingId}`).catch(() => {})
      await api.close().catch(() => {})
    }
  })
})
