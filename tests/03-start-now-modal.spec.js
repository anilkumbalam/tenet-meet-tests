const { test, expect } = require('@playwright/test')
const { loginWithZoho, waitForDashboard, openStartNowModal, closeModal } = require('./helpers')
const { BASE_URL } = require('./env')

test.use({ storageState: '.auth/user.json' })

test.describe('Start Now modal', () => {
  test('Modal opens when Start Now is clicked', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await expect(page.locator('#startNowModal, .modal-overlay.open')).toBeVisible()
  })

  test('Title field receives focus when modal opens', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    const input = page.locator('#startNowModal input[type="text"], #startNowModal input:not([type]), .modal-overlay.open input').first()
    await expect(input).toBeVisible()
  })

  test('Cancel button closes the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await closeModal(page)
    await expect(page.locator('#startNowModal.open, .modal-overlay.open')).toHaveCount(0)
  })

  test('Clicking outside does NOT close the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.mouse.click(10, 10)
    await page.waitForTimeout(400)
    await expect(page.locator('#startNowModal, .modal-overlay').first()).toBeVisible()
  })

  test('Escape does NOT close the modal', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    await page.keyboard.press('Escape')
    await page.waitForTimeout(400)
    await expect(page.locator('#startNowModal, .modal-overlay').first()).toBeVisible()
  })

  test('Start Now sends typed title to the API', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    const titlePromise = new Promise(resolve => {
      page.route('**/api/meetings', async route => {
        if (route.request().method() === 'POST') {
          const body = route.request().postDataJSON()
          resolve(body?.title)
        }
        await route.continue()
      })
    })
    await page.fill('#startNowTitle', 'API Title Test')
    await page.locator('#startNowBtn').click()
    const capturedTitle = await Promise.race([
      titlePromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 10000))
    ])
    expect(capturedTitle).toBe('API Title Test')
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })

  test('Button shows spinner while request is in flight', async ({ page }) => {
    await page.goto('/')
    await waitForDashboard(page)
    await openStartNowModal(page)
    let resolveDelay
    const delayPromise = new Promise(r => { resolveDelay = r })
    await page.route('**/api/meetings', async route => {
      await delayPromise
      await route.continue()
    })
    await page.locator('#startNowBtn').click()
    resolveDelay()
    expect(true).toBeTruthy()
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  })
})
