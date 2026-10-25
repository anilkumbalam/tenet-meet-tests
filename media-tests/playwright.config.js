import { createRequire } from 'module'
const require = createRequire(import.meta.url)
const { defineConfig } = require('@playwright/test')

export default defineConfig({
  testDir: './specs',
  timeout: 120000,
  workers: 1,
  retries: 1,
  reporter: [['list'], ['html', { outputFolder: 'media-report', open: 'never' }]],
  use: {
    headless: true,
    launchOptions: {
      args: [
        '--use-fake-ui-for-media-stream',
        '--use-fake-device-for-media-stream',
        '--auto-select-desktop-capture-source=Entire screen',
        '--no-sandbox',
      ]
    }
  }
})
