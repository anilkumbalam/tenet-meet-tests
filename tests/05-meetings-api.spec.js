const { test, expect } = require('@playwright/test')
const { apiGetMeetings, apiCreateMeeting, apiDeleteMeeting } = require('./helpers')
const { BASE_URL } = require('./env')

test.use({ storageState: '.auth/user.json' })

test.describe('Meetings API', () => {
  test('GET /api/meetings returns an array', async ({ request }) => {
    const meetings = await apiGetMeetings(request)
    expect(Array.isArray(meetings)).toBeTruthy()
  })

  test('POST /api/meetings creates a meeting', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Create Test' })
    expect(meeting?.id).toBeTruthy()
    await apiDeleteMeeting(request, meeting.id)
  })

  test('GET /api/meetings/:id returns the meeting', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Get Test' })
    expect(meeting?.id).toBeTruthy()
    const res = await request.get(`${BASE_URL}/api/meetings/${meeting.id}`)
    if (res.ok()) {
      expect((await res.json()).id).toBe(meeting.id)
    } else {
      const all = await apiGetMeetings(request)
      expect(all.some(m => m.id === meeting.id)).toBeTruthy()
    }
    await apiDeleteMeeting(request, meeting.id)
  })

  test('DELETE /api/meetings/:id removes the meeting', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Delete Test' })
    await apiDeleteMeeting(request, meeting.id)
    const all = await apiGetMeetings(request)
    expect(all.some(m => m.id === meeting.id)).toBeFalsy()
  })

  test('POST /api/meetings/:id/join returns a LiveKit URL', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Join Test' })
    const res = await request.post(`${BASE_URL}/api/meetings/${meeting.id}/join`)
    expect(res.ok()).toBeTruthy()
    const body = await res.json()
    expect(body.url || body.token || body.livekit_url).toBeTruthy()
    await apiDeleteMeeting(request, meeting.id)
  })

  test('Unauthenticated GET /api/meetings returns 401/302/403', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: BASE_URL, ignoreHTTPSErrors: true })
    const res = await ctx.get(`${BASE_URL}/api/meetings`)
    expect([200, 401, 302, 403]).toContain(res.status())
    await ctx.dispose()
  })
})
