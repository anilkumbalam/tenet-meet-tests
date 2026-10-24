const { test, expect } = require('@playwright/test')
const { AUTH_STATE_PATH, waitForDashboard, clickTab } = require('./helpers')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Dashboard', () => {

  test('Dashboard loads with correct header and action buttons', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('button:has-text("Start Now"), .btn:has-text("Start")')).toBeVisible()
    await expect(page.locator('button:has-text("Schedule"), .btn:has-text("Schedule")')).toBeVisible()
  })

  test('Active, Scheduled, Ended tabs all exist', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('.tab-btn:has-text("Active")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Scheduled")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Ended")')).toBeVisible()
  })

  test('Clicking Scheduled tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Scheduled')
    await expect(page.locator('#meetings-container, .meetings-list')).toBeVisible()
  })

  test('Clicking Ended tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Ended')
    await expect(page.locator('#meetings-container, .meetings-list')).toBeVisible()
  })

  test('Active tab is selected by default', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    const activeTab = page.locator('.tab-btn.active, .tab-btn[aria-selected="true"]').first()
    const label = await activeTab.textContent()
    expect(label?.toLowerCase()).toContain('active')
  })

})
