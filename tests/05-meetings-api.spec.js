const { test, expect } = require('@playwright/test')
const { BASE_URL } = require('./env')
const { AUTH_STATE_PATH, apiCreateMeeting, apiDeleteMeeting } = require('./helpers')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Meetings API', () => {

  test('GET /api/meetings returns an array', async ({ request }) => {
    const res = await request.get(`${BASE_URL}/api/meetings`)
    expect(res.ok()).toBeTruthy()
    expect(Array.isArray(await res.json())).toBeTruthy()
  })

  test('POST /api/meetings creates a meeting', async ({ request }) => {
    const title   = `API Test ${Date.now()}`
    const meeting = await apiCreateMeeting(request, { title })
    expect(meeting?.id).toBeTruthy()
    expect(meeting.title).toBe(title)
    await apiDeleteMeeting(request, meeting.id)
  })

  test('GET /api/meetings/:id returns the meeting', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Get Test' })
    const res     = await request.get(`${BASE_URL}/api/meetings/${meeting.id}`)
    expect(res.ok()).toBeTruthy()
    expect((await res.json()).id).toBe(meeting.id)
    await apiDeleteMeeting(request, meeting.id)
  })

  test('DELETE /api/meetings/:id removes the meeting', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Delete Test' })
    await apiDeleteMeeting(request, meeting.id)
    const res = await request.get(`${BASE_URL}/api/meetings/${meeting.id}`)
    expect(res.status()).toBe(404)
  })

  test('POST /api/meetings/:id/join returns a LiveKit URL', async ({ request }) => {
    const meeting = await apiCreateMeeting(request, { title: 'Join Test' })
    const res     = await request.post(`${BASE_URL}/api/meetings/${meeting.id}/join`)
    expect(res.ok()).toBeTruthy()
    const data = await res.json()
    expect(data.url || data.token).toBeTruthy()
    await apiDeleteMeeting(request, meeting.id)
  })

  test('Unauthenticated GET /api/meetings returns 401/302/403', async ({ browser }) => {
    const ctx     = await browser.newContext()
    const request = await ctx.request.newContext({ baseURL: BASE_URL })
    const res     = await request.get(`${BASE_URL}/api/meetings`)
    expect([401, 302, 403]).toContain(res.status())
    await ctx.close()
  })

})
