// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')

/*
  76 - Meeting-full handling + max_participants lifecycle

  Covers:
  - Server returns 400 + { code: "MEETING_FULL", friendly message } on both
    the authenticated (/api/meetings/:id/join) and guest
    (/api/guest-join/:roomUuid) endpoints when the cap is reached.
  - Dashboard maps "Meeting is full" into the friendly participant-limit
    message (via joinMsg).
  - Lifecycle: blocked → host raises cap mid-meeting → same guest admitted
    → host lowers cap → next new guest blocked again.
  - settings endpoint rejects non-host callers with 403.
*/

test.describe('76 - meeting is full', () => {

  test('auth join: 400 with MEETING_FULL code and friendly message', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'mf76', { max_participants: 2 })
    try {
      const host = await h.joinAsHost(m.meetingId)
      const guest = await h.joinAsGuest(m.roomUuid, 'Fill Guest')
      try {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
        await h.setAuthCookie(ctx, 'third.user@tenetnetworks.com', 'Third User')
        const page = await ctx.newPage()
        const res = await page.request.post(`${h.BASE_URL}/api/meetings/${m.meetingId}/join`, {
          data: { device_id: `test-mf-${Date.now()}` }
        })

        expect(res.status()).toBe(400)
        const body = await res.json()
        expect(body.code).toBe('MEETING_FULL')
        expect(body.error).toBe('Meeting is full')
        expect(body.message).toContain('participant limit')
        expect(body.message.toLowerCase()).toContain('try again later')

        await ctx.close()
      } finally {
        await guest.browser.close()
        await host.browser.close()
      }
    } finally {
      await m.api.close()
    }
  })

  test('guest join: 400 with MEETING_FULL code and friendly message', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'mf76g', { max_participants: 2 })
    try {
      const host = await h.joinAsHost(m.meetingId)
      const guest = await h.joinAsGuest(m.roomUuid, 'Fill Guest')
      try {
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
        const page = await ctx.newPage()
        const res = await page.request.post(`${h.BASE_URL}/api/guest-join/${m.roomUuid}`, {
          data: { display_name: 'Latecomer Guest', device_id: `test-mfg-${Date.now()}` }
        })

        expect(res.status()).toBe(400)
        const body = await res.json()
        expect(body.code).toBe('MEETING_FULL')
        expect(body.error).toBe('Meeting is full')
        expect(body.message).toContain('participant limit')

        await ctx.close()
      } finally {
        await guest.browser.close()
        await host.browser.close()
      }
    } finally {
      await m.api.close()
    }
  })

  test('dashboard UI: "Meeting is full" is mapped to the friendly participant-limit message', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await h.setAuthCookie(ctx, 'other.user@tenetnetworks.com', 'Other User')
    const page = await ctx.newPage()
    await page.goto(`${h.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })

    const result = await page.evaluate(() => {
      if (typeof window.joinMsg === 'function') {
        try { return { kind: 'fn', msg: window.joinMsg('Meeting is full') } }
        catch (e) { return { kind: 'fn-err', err: String(e) } }
      }
      const src = Array.from(document.scripts).map(s => s.textContent || '').join('\n')
      const re = /Meeting is full[\s\S]{0,400}participant limit[\s\S]{0,400}try again later/i
      return { kind: 'src', hasMapping: re.test(src) }
    })

    if (result.kind === 'fn') {
      const text = (result.msg || '').toLowerCase()
      expect(text, 'joinMsg("Meeting is full") returned: ' + JSON.stringify(result.msg)).toContain('participant limit')
      expect(text).toContain('try again later')
    } else if (result.kind === 'src') {
      expect(result.hasMapping,
        'Dashboard inline script must map "Meeting is full" → friendly participant-limit message'
      ).toBe(true)
    } else {
      throw new Error('joinMsg threw: ' + result.err)
    }

    await ctx.close()
  })

  test('lifecycle: full → host raises cap → guest admitted → lower cap → next guest blocked', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'mf76l', { max_participants: 2 })
    try {
      const host = await h.joinAsHost(m.meetingId)
      const guest = await h.joinAsGuest(m.roomUuid, 'Fill Guest')
      try {
        // --- 1. Third guest is blocked (cap 2, filled by host + 1 guest)
        const guestCtx = await browser.newContext({ ignoreHTTPSErrors: true })
        const guestPage = await guestCtx.newPage()
        const deviceA = `test-mfl-A-${Date.now()}`
        let res = await guestPage.request.post(`${h.BASE_URL}/api/guest-join/${m.roomUuid}`, {
          data: { display_name: 'Patient Guest', device_id: deviceA }
        })
        expect(res.status(), 'third guest should be blocked at cap=2').toBe(400)
        let body = await res.json()
        expect(body.code).toBe('MEETING_FULL')
        expect(body.message).toContain('participant limit')

        // --- 2. Host raises the cap mid-meeting
        const hostCtx = await browser.newContext({ ignoreHTTPSErrors: true })
        await h.setAuthCookie(hostCtx, h.HOST_EMAIL, 'Host')
        const hostPage = await hostCtx.newPage()
        let up = await hostPage.request.post(
          `${h.BASE_URL}/api/meetings/${m.meetingId}/settings`,
          { data: { max_participants: 5 } }
        )
        expect(up.status(), 'host raises cap to 5').toBe(200)
        const upBody = await up.json()
        expect(upBody.ok).toBe(true)
        expect(upBody.max_participants).toBe(5)

        // --- 3. Same third guest retries and is admitted
        res = await guestPage.request.post(`${h.BASE_URL}/api/guest-join/${m.roomUuid}`, {
          data: { display_name: 'Patient Guest', device_id: deviceA }
        })
        expect(res.status(), 'third guest admitted after cap raised').toBe(200)
        body = await res.json()
        // guest-join returns { url: "/meeting/<uuid>?token=...&pid=...&pk=...&mid=...&host=..." }
        expect(body).toHaveProperty('url')
        expect(body.url).toContain(`/meeting/${m.roomUuid}`)
        const admittedUrl = new URL(body.url, h.BASE_URL)
        const admittedToken = admittedUrl.searchParams.get('token')
        expect(admittedToken, 'token query param on admitted guest-join url').toBeTruthy()
        expect(admittedToken.length).toBeGreaterThan(20)

        // --- 4. Host lowers cap back to 2; a FOURTH, new guest is blocked again
        up = await hostPage.request.post(
          `${h.BASE_URL}/api/meetings/${m.meetingId}/settings`,
          { data: { max_participants: 2 } }
        )
        expect(up.status(), 'host lowers cap back to 2').toBe(200)
        expect((await up.json()).max_participants).toBe(2)

        const lateCtx = await browser.newContext({ ignoreHTTPSErrors: true })
        const latePage = await lateCtx.newPage()
        res = await latePage.request.post(`${h.BASE_URL}/api/guest-join/${m.roomUuid}`, {
          data: { display_name: 'Late Late Guest', device_id: `test-mfl-B-${Date.now()}` }
        })
        expect(res.status(), 'new guest blocked again after cap lowered').toBe(400)
        expect((await res.json()).code).toBe('MEETING_FULL')

        await lateCtx.close()
        await hostCtx.close()
        await guestCtx.close()
      } finally {
        await guest.browser.close()
        await host.browser.close()
      }
    } finally {
      await m.api.close()
    }
  })

  test('settings endpoint: non-host is rejected with 403', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'mf76s', { max_participants: 2 })
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
      await h.setAuthCookie(ctx, 'imposter.user@tenetnetworks.com', 'Imposter')
      const page = await ctx.newPage()
      const res = await page.request.post(
        `${h.BASE_URL}/api/meetings/${m.meetingId}/settings`,
        { data: { max_participants: 5 } }
      )
      expect(res.status()).toBe(403)
      await ctx.close()
    } finally {
      await m.api.close()
    }
  })

  test('settings endpoint: invalid max_participants is rejected with 400', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'mf76v', { max_participants: 2 })
    try {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
      await h.setAuthCookie(ctx, h.HOST_EMAIL, 'Host')
      const page = await ctx.newPage()

      for (const bad of [0, -1, 1.5, 'abc', null, undefined, 99999]) {
        const res = await page.request.post(
          `${h.BASE_URL}/api/meetings/${m.meetingId}/settings`,
          { data: { max_participants: bad } }
        )
        expect(res.status(), `max_participants=${JSON.stringify(bad)} should be 400`).toBe(400)
      }

      await ctx.close()
    } finally {
      await m.api.close()
    }
  })
})
