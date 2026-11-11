const { test, expect } = require('./guard')
const { AUTH_STATE_PATH, waitForDashboard, clickTab, apiCreateMeeting, apiDeleteMeeting, apiEndMeeting, freshAuthState } = require('./helpers')
const { BASE_URL } = require('./env')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Meeting list', () => {
  test.beforeAll(async ({ browser }) => { await freshAuthState(browser) })   // 10 Nov: the saved sign-in is signed out after 1 hour without use


  test('Scheduled meeting appears in Upcoming tab', async ({ page, request }) => {
    const title    = `tl-${Date.now().toString(36)}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const meeting  = await apiCreateMeeting(request, { title, scheduled_at: `${tomorrow}T10:00:00` })
    expect(meeting?.id).toBeTruthy()

    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Upcoming')
    await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 10000 })

    await apiDeleteMeeting(request, meeting.id)
  })

  test('Ended meeting appears in Past tab', async ({ page, request }) => {
    const title   = `te-${Date.now().toString(36)}`
    const meeting = await apiCreateMeeting(request, { title })
    expect(meeting?.id).toBeTruthy()

    await apiEndMeeting(request, meeting.id)

    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Past')
    await expect(page.locator(`text=${title}`)).toBeVisible({ timeout: 10000 })
  })

  test('Meeting cards show title and action buttons', async ({ page, request }) => {
    const title    = `tc-${Date.now().toString(36)}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const meeting  = await apiCreateMeeting(request, { title, scheduled_at: `${tomorrow}T11:00:00` })
    expect(meeting?.id).toBeTruthy()

    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Upcoming')

    const card = page.locator(`.meeting-card:has-text("${title}"), [data-meeting-id="${meeting.id}"]`)
    await expect(card).toBeVisible({ timeout: 10000 })
    await expect(card.locator('button:has-text("Copy link"), button:has-text("Join"), button:has-text("Start")')).toBeVisible()

    await apiDeleteMeeting(request, meeting.id)
  })

})
