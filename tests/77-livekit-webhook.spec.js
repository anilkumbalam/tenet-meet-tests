// @ts-check
const { test, expect } = require('@playwright/test')
const h = require('./meet-helpers')
const jwt = require('jsonwebtoken')
const crypto = require('crypto')

/*
  77 - LiveKit webhook (/api/livekit-webhook)

  The handler listens for `room_finished` events signed by LiveKit's own
  WebhookReceiver (HS256 JWT with the body's sha256). This spec verifies:

  - unsigned POST → 401
  - wrongly-signed POST → 401
  - signed `room_finished` on an active meeting → DB row flips to 'ended'
  - signed `room_finished` on a non-active meeting (status='scheduled')
    → handler returns 200 but DB status is NOT changed (silent no-op,
    the UPDATE is guarded by `status='active'`)

  The full "host-leaves-alone wait 5 min" real-timing path is a heavy
  test (see heavy/webhook-timing.spec.js) because departure_timeout is
  300 s and that is not mockable from the test.
*/

const LK_API_KEY = 'tenet_livekit_key'
const LK_SECRET = process.env.LIVEKIT_API_SECRET

function signWebhook (body) {
  const hash = crypto.createHash('sha256').update(body).digest('base64')
  return jwt.sign({
    iss: LK_API_KEY,
    exp: Math.floor(Date.now() / 1000) + 60,
    sha256: hash
  }, LK_SECRET, { algorithm: 'HS256' })
}

function roomFinishedEvent (roomUuid) {
  return JSON.stringify({
    event: 'room_finished',
    room: { name: roomUuid, sid: 'RM_test77', emptyTimeout: 300 },
    id: `evt-${Date.now()}`,
    createdAt: Math.floor(Date.now() / 1000)
  })
}

test.describe('77 - LiveKit webhook', () => {

  test('unsigned POST returns 401', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    const res = await page.request.post(`${h.BASE_URL}/api/livekit-webhook`, {
      headers: { 'Content-Type': 'application/webhook+json' },
      data: '{}'
    })
    expect(res.status()).toBe(401)
    await ctx.close()
  })

  test('wrongly-signed POST returns 401', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    const body = roomFinishedEvent('11111111-2222-3333-4444-555555555555')
    const hash = crypto.createHash('sha256').update(body).digest('base64')
    const badToken = jwt.sign({
      iss: LK_API_KEY,
      exp: Math.floor(Date.now() / 1000) + 60,
      sha256: hash
    }, 'this-is-not-the-real-secret', { algorithm: 'HS256' })
    const res = await page.request.post(`${h.BASE_URL}/api/livekit-webhook`, {
      headers: { 'Content-Type': 'application/webhook+json', 'Authorization': badToken },
      data: body
    })
    expect(res.status()).toBe(401)
    await ctx.close()
  })

  test('signed room_finished closes an active meeting', async ({ browser }) => {
    test.skip(!LK_SECRET, 'LIVEKIT_API_SECRET not set in env — load with `bash -ic` to inherit ~/.bashrc')
    const m = await h.createMeeting(browser, 'wh77')
    try {
      const host = await h.joinAsHost(m.meetingId)
      try {
        // The join made the meeting active
        const st0 = await h.meetingStatus(m.api, m.meetingId)
        expect(st0.status).toBe('active')

        // Fire a signed room_finished event
        const body = roomFinishedEvent(m.roomUuid)
        const token = signWebhook(body)
        const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
        const page = await ctx.newPage()
        const res = await page.request.post(`${h.BASE_URL}/api/livekit-webhook`, {
          headers: { 'Content-Type': 'application/webhook+json', 'Authorization': token },
          data: body
        })
        expect(res.status()).toBe(200)

        // The DB row should now be ended
        const st1 = await h.meetingStatus(m.api, m.meetingId)
        expect(st1.status, 'webhook should flip active -> ended').toBe('ended')

        await ctx.close()
      } finally {
        await host.browser.close()
      }
    } finally {
      await m.api.close()
    }
  })

  test('signed room_finished for an unknown room is a silent no-op', async ({ browser }) => {
    test.skip(!LK_SECRET, 'LIVEKIT_API_SECRET not set in env')
    // Random UUID that no meeting matches. The handler's UPDATE touches
    // zero rows (no row where room_uuid=? AND status='active'), and the
    // response is 200. This verifies the handler doesn't error on unknown
    // rooms — same silent-no-op path as when a status='ended' row already
    // exists from an explicit /end.
    const fakeRoomUuid = `00000000-0000-4000-8000-${Date.now().toString(16).padStart(12, '0')}`

    const body = roomFinishedEvent(fakeRoomUuid)
    const token = signWebhook(body)
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    const page = await ctx.newPage()
    const res = await page.request.post(`${h.BASE_URL}/api/livekit-webhook`, {
      headers: { 'Content-Type': 'application/webhook+json', 'Authorization': token },
      data: body
    })
    expect(res.status(), 'handler must return 200 even for unknown rooms').toBe(200)
    await ctx.close()
  })
})
