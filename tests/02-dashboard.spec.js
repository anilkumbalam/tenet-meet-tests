const { test, expect } = require('@playwright/test')
const { loginWithZoho, waitForDashboard, clickTab } = require('./helpers')

test.use({ storageState: '.auth/user.json' })

test.describe('Dashboard', () => {
  test('Dashboard loads with correct header and action buttons', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('button.btn-primary:has-text("Start Now")').first()).toBeVisible()
    await expect(page.locator('button.btn-secondary:has-text("Schedule")')).toBeVisible()
  })

  test('Active, Scheduled, Past tabs all exist', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('.tab-btn:has-text("Active")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Scheduled")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Past")')).toBeVisible()
  })

  test('Clicking Scheduled tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Scheduled')
    await expect(page.locator('.tab-btn:has-text("Scheduled")')).toHaveClass(/active/)
  })

  test('Clicking Past tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Past')
    await expect(page.locator('.tab-btn:has-text("Past")')).toHaveClass(/active/)
  })

  test('Active tab is selected by default', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('.tab-btn:has-text("Active")')).toHaveClass(/active/)
  })
})
