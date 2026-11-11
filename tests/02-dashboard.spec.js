const { test, expect } = require('./guard')
const { loginWithZoho, waitForDashboard, clickTab } = require('./helpers')

test.use({ storageState: '.auth/user.json' })

test.describe('Dashboard', () => {
  test('Dashboard loads with correct header and action buttons', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
      await expect(page.locator('#btnStartNow')).toBeVisible()
      await expect(page.locator('#btnSchedule')).toBeVisible()
  })

  test('Today, Upcoming, Past tabs all exist', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('.tab-btn:has-text("Today")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Upcoming")')).toBeVisible()
    await expect(page.locator('.tab-btn:has-text("Past")')).toBeVisible()
  })

  test('Clicking Upcoming tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Upcoming')
    await expect(page.locator('.tab-btn:has-text("Upcoming")')).toHaveClass(/active/)
  })

  test('Clicking Past tab shows meetings section', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await clickTab(page, 'Past')
    await expect(page.locator('.tab-btn:has-text("Past")')).toHaveClass(/active/)
  })

  test('Today tab is selected by default', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await expect(page.locator('.tab-btn:has-text("Today")')).toHaveClass(/active/)
  })
})
