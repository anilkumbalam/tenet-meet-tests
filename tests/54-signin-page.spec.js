// 54 - New sign-in page (7 Nov). Same behaviour as before, new look.
//  - Strict security policy, nothing blocked by it, no page errors.
//  - "Sign in", the Tenet email line, the button to sign-in, the guest note.
//  - A sign-in message (idle / expired / disabled) shows in the card and hides the guest note.
//  - Fits a phone (no sideways scrolling).
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const BASE = H.BASE_URL || ENV.BASE_URL

test.describe('54 - Sign-in page', () => {

  test('strict policy, no errors; heading, email line, button and guest note', async ({ page }) => {
    const errors = []
    page.on('pageerror', e => errors.push(e.message))
    await page.addInitScript(() => { document.addEventListener('securitypolicyviolation', e => { (window.__csp = window.__csp || []).push(e.violatedDirective + ' ' + e.blockedURI) }) })
    const r = await page.goto(`${BASE}/start`)
    const csp = r.headers()['content-security-policy'] || ''
    expect(csp).toMatch(/script-src 'self'(;|\s*$)/)
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/)
    await expect(page.locator('h1')).toHaveText('Sign in')
    await expect(page.locator('.sub')).toContainText('name@tenetnetworks.com')
    await expect(page.locator('a.btn-signin')).toHaveAttribute('href', '/auth/login')
    await expect(page.locator('.guest')).toBeVisible()
    await expect(page.locator('#errMsg')).toBeHidden()
    await page.waitForTimeout(500)
    errors.push(...(await page.evaluate(() => window.__csp || [])))
    expect(errors, 'page errors or blocked content').toEqual([])
  })

  for (const [q, text] of [['ended=idle', 'after an hour without use'], ['ended=expired', 'sign-in expired'], ['error=disabled', 'disabled']]) {
    test(`with ?${q}: the message shows in the card, the guest note is hidden`, async ({ page }) => {
      await page.goto(`${BASE}/start?${q}`)
      await expect(page.locator('#errMsg')).toBeVisible()
      await expect(page.locator('#errMsg')).toContainText(text)
      await expect(page.locator('.guest')).toBeHidden()
    })
  }

  test('fits a phone: no sideways scrolling, button full width', async ({ browser }) => {
    const ctx = await browser.newContext({ viewport: { width: 360, height: 640 }, isMobile: true, hasTouch: true })
    const page = await ctx.newPage()
    await page.goto(`${BASE}/start`)
    const m = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, bw: document.querySelector('a.btn-signin').getBoundingClientRect().width }))
    expect(m.sw).toBeLessThanOrEqual(m.cw)
    expect(m.bw).toBeGreaterThan(m.cw * 0.8)
    await ctx.close()
  })
})
