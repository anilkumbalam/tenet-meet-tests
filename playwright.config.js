const { defineConfig, devices } = require('@playwright/test')
const { BASE_URL } = require('./tests/env')

module.exports = defineConfig({
  testDir: './tests',
  timeout: 60000,
  retries: 1,
  workers: 1,

  use: {
    baseURL: BASE_URL,
    headless: true,
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium-browser',
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: true,
  },

  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],

  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
})
