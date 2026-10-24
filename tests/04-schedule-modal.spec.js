const { test, expect } = require('@playwright/test')
const { AUTH_STATE_PATH, waitForDashboard, openScheduleModal, closeModal, apiDeleteMeeting } = require('./helpers')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Schedule modal', () => {

  test('Schedule modal opens with all required fields', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await expect(page.locator('#schedTitle, input[name="title"]')).toBeVisible()
    await expect(page.locator('#schedDate, input[type="date"]')).toBeVisible()
    await expect(page.locator('#schedTime, input[type="time"]')).toBeVisible()
  })

  test('Cancel button closes the Schedule modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await closeModal(page)
    await expect(page.locator('#schedModal')).not.toHaveClass(/open/)
  })

  test('Clicking outside does NOT close the Schedule modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await page.locator('#schedModal').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(300)
    await expect(page.locator('#schedModal')).toHaveClass(/open/)
    await closeModal(page)
  })

  test('Scheduling a meeting shows it in the Scheduled tab', async ({ page, request }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)

    const title    = `Playwright Test ${Date.now()}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]

    await page.fill('#schedTitle, input[name="title"]', title)
    await page.fill('#schedDate, input[type="date"]', tomorrow)
    await page.fill('#schedTime, input[type="time"]', '10:00')

    const [response] = await Promise.all([
      page.waitForResponse(res => res.url().includes('/api/meetings') && res.request().method() === 'POST'),
      page.locator('#schedSubmitBtn, .modal-overlay.open .btn-primary').click(),
    ])

    const meeting = await response.json().catch(() => null)
    await page.waitForSelector('#schedModal:not(.open)', { timeout: 10000 })

    await page.locator('.tab-btn:has-text("Scheduled")').click()
    await expect(page.locator(`text=${title}`)).toBeVisible()

    if (meeting?.id) await apiDeleteMeeting(request, meeting.id)
  })

})
