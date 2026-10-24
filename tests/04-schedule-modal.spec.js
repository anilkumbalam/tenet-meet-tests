const { test, expect } = require('@playwright/test')
const { waitForDashboard, openScheduleModal, closeModal, clickTab } = require('./helpers')
const { BASE_URL } = require('./env')

test.use({ storageState: '.auth/user.json' })

test.describe('Schedule modal', () => {
  test('Schedule modal opens with all required fields', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await expect(page.locator('#mTitle')).toBeVisible()
    await expect(page.locator('#mDate')).toBeVisible()
    await expect(page.locator('#mTimeOnly')).toBeVisible()
  })

  test('Cancel button closes the Schedule modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await closeModal(page)
    await expect(page.locator('.modal-overlay.open')).toHaveCount(0)
  })

  test('Clicking outside does NOT close the Schedule modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    await page.mouse.click(10, 10)
    await page.waitForTimeout(400)
    await expect(page.locator('#mTitle')).toBeVisible()
  })

  test('Scheduling a meeting shows it in the Scheduled tab', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openScheduleModal(page)
    const title = `ts-${Date.now().toString(36)}`
    const tomorrow = new Date(Date.now() + 86400000).toISOString().split('T')[0]
    await page.fill('#mTitle', title)
    await page.fill('#mDate', tomorrow)
    await page.fill('#mTimeOnly', '10:00')
    await page.locator('#schedBtn, button:has-text("Create Meeting")').click()
    await page.waitForTimeout(1500)
    await clickTab(page, 'Scheduled')
    await expect(page.locator(`.meeting-card:has-text("${title}"), .card:has-text("${title}")`)).toBeVisible({ timeout: 10000 })
  })
})
