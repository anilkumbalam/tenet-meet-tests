const { test, expect } = require('@playwright/test')
const { AUTH_STATE_PATH, waitForDashboard, clickTab, apiCreateMeeting, apiDeleteMeeting, apiEndMeeting } = require('./helpers')
const { BASE_URL } = require('./env')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Meeting list', () => {

  test('Scheduled meeting appears in Scheduled tab', async ({ page, request }) => {
    const title    = `tl-${Date.now().toString(36)}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const meeting  = await apiCreateMeeting(request, { title, scheduled_at: `${tomorrow}T10:00:00` })
    expect(meeting?.id).toBeTruthy()

    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Scheduled')
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

  test('Meeting cards show title and a Join button', async ({ page, request }) => {
    const title    = `tc-${Date.now().toString(36)}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    const meeting  = await apiCreateMeeting(request, { title, scheduled_at: `${tomorrow}T11:00:00` })
    expect(meeting?.id).toBeTruthy()

    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Scheduled')

    const card = page.locator(`.meeting-card:has-text("${title}"), [data-meeting-id="${meeting.id}"]`)
    await expect(card).toBeVisible({ timeout: 10000 })
    await expect(card.locator('button:has-text("Join"), button:has-text("Start"), a:has-text("Join")')).toBeVisible()

    await apiDeleteMeeting(request, meeting.id)
  })

})
