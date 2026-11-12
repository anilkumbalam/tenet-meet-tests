// @ts-check
/*
  Heavy — visual regression on key screens (not in the main run).
  Uses Playwright's toHaveScreenshot which stores baselines next to this spec
  under __screenshots__/. First run on a clean checkout needs baselines:

    npx playwright test tests/heavy/visual-regression.spec.js --update-snapshots

  Subsequent runs compare against the baselines and fail on diff above the
  configured tolerance.
*/
const { test, expect } = require('@playwright/test')
const h = require('../meet-helpers')

const MASK = (page, selectors) => selectors.map(s => page.locator(s)).filter(Boolean)
// Always mask moving bits: timers, live participant counts, random colours
const VOLATILE = ['#timer', '#today', '.when span', '.chat-time']

test.describe('heavy - visual regression', () => {
  test.beforeEach(async ({ page }) => {
    // Disable animations so screenshots are deterministic
    await page.addStyleTag({ content: `
      *, *::before, *::after {
        animation-duration: 0s !important;
        transition-duration: 0s !important;
        animation-delay: 0s !important;
        transition-delay: 0s !important;
      }
    `}).catch(() => {})
  })

  test('dashboard - today tab', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await h.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${h.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1000)
    await expect(page).toHaveScreenshot('dashboard-today.png', {
      fullPage: true,
      mask: MASK(page, VOLATILE),
      maxDiffPixelRatio: 0.02
    })
    await ctx.close()
  })

  test('dashboard - upcoming tab', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await h.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${h.BASE_URL}/dashboard#upcoming`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.waitForTimeout(1000)
    await expect(page).toHaveScreenshot('dashboard-upcoming.png', {
      fullPage: true,
      mask: MASK(page, VOLATILE),
      maxDiffPixelRatio: 0.02
    })
    await ctx.close()
  })

  test('schedule modal - empty', async ({ browser }) => {
    const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
    await h.setAuthCookie(ctx)
    const page = await ctx.newPage()
    await page.goto(`${h.BASE_URL}/dashboard`, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('#acctBtn')).toBeVisible({ timeout: 15000 })
    await page.locator('#btnSchedule').click()
    await page.waitForTimeout(600)
    await expect(page).toHaveScreenshot('schedule-modal-empty.png', {
      mask: MASK(page, VOLATILE),
      maxDiffPixelRatio: 0.02
    })
    await ctx.close()
  })

  test('meeting room - host, panel closed', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'vr')
    const host = await h.joinAsHost(m.meetingId)
    try {
      await host.page.waitForTimeout(3500)
      await expect(host.page).toHaveScreenshot('meeting-room-panel-closed.png', {
        fullPage: true,
        mask: MASK(host.page, VOLATILE),
        maxDiffPixelRatio: 0.02
      })
    } finally {
      await host.browser.close()
      await m.api.close()
    }
  })

  test('meeting room - chat panel open, Everyone', async ({ browser }) => {
    const m = await h.createMeeting(browser, 'vr')
    const host = await h.joinAsHost(m.meetingId)
    try {
      await host.page.waitForTimeout(3500)
      await h.openPanel(host.page)
      await host.page.locator('#right-panel .tp-tab[data-tab="chat"]').click()
      await host.page.waitForSelector('#pc-tabs', { timeout: 8000 })
      await host.page.waitForTimeout(500)
      await expect(host.page).toHaveScreenshot('meeting-chat-everyone.png', {
        fullPage: true,
        mask: MASK(host.page, VOLATILE),
        maxDiffPixelRatio: 0.02
      })
    } finally {
      await host.browser.close()
      await m.api.close()
    }
  })
})
