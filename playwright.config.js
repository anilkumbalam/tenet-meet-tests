const { defineConfig } = require('@playwright/test')
const { BASE_URL } = require('./tests/env')

module.exports = defineConfig({
  testDir: './tests',
  timeout: 120000,
  globalTimeout: 600000,
  retries: 1,
  workers: 1,
  use: {
    baseURL: BASE_URL,
    headless: true,
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
    actionTimeout: 30000,
    launchOptions: {
      executablePath: '/root/.cache/ms-playwright/chromium-1228/chrome-linux64/chrome',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
      ],
    },
  },
})
