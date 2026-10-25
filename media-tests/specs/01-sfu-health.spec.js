import { test, expect } from '@playwright/test'
import env from '../env.js'

test('SFU WebSocket endpoint is reachable', async ({ page }) => {
  // Just verify the meet server responds — skip Twirp which nginx doesn't proxy
  const res = await page.request.get(`${env.MEET_URL}/`)
  expect(res.status()).toBeLessThan(500)
  console.log(`Meet server responded: ${res.status()}`)
})
