const { test, expect } = require('@playwright/test')
const { AUTH_STATE_PATH, waitForDashboard, openStartNowModal, closeModal } = require('./helpers')

test.use({ storageState: AUTH_STATE_PATH })

test.describe('Start Now modal', () => {

  test('Modal opens when Start Now is clicked', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await expect(page.locator('#startNowModal')).toHaveClass(/open/)
    await expect(page.locator('#startNowTitle')).toBeVisible()
    await expect(page.locator('#startNowBtn')).toBeVisible()
  })

  test('Title field receives focus when modal opens', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.waitForTimeout(200)
    await expect(page.locator('#startNowTitle')).toBeFocused()
  })

  test('Cancel button closes the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await closeModal(page)
    await expect(page.locator('#startNowModal')).not.toHaveClass(/open/)
  })

  test('Clicking outside does NOT close the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.locator('#startNowModal').click({ position: { x: 5, y: 5 } })
    await page.waitForTimeout(300)
    await expect(page.locator('#startNowModal')).toHaveClass(/open/)
    await closeModal(page)
  })

  test('Escape does NOT close the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    await expect(page.locator('#startNowModal')).toHaveClass(/open/)
    await closeModal(page)
  })

  test('Start Now sends typed title to the API', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.fill('#startNowTitle', 'Team Standup')
    const [request] = await Promise.all([
      page.waitForRequest(req => req.url().includes('/api/meetings') && req.method() === 'POST'),
      page.locator('#startNowBtn').click(),
    ])
    const body = JSON.parse(request.postData() || '{}')
    expect(body.title).toBe('Team Standup')
  })

  test('Button shows spinner while request is in flight', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.route('**/api/meetings', async route => {
      await page.waitForTimeout(800)
      await route.continue()
    })
    await page.locator('#startNowBtn').click()
    await expect(page.locator('#startNowBtn')).toBeDisabled()
    const text = await page.locator('#startNowBtn').textContent()
    expect(text).toContain('Starting')
  })

})
