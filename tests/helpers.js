const { BASE_URL } = require('./env')
const path = require('path')
const fs   = require('fs')

const CREDENTIALS = {
  primary: {
    email:    process.env.MEET_USER  || 'anil@tenetnetworks.com',
    password: process.env.MEET_PASS  || '',
  },
}

const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth', 'user.json')

async function loginWithZoho(page, credentials = CREDENTIALS.primary) {
  await page.goto('/')
  await page.waitForLoadState('domcontentloaded')

  const isDashboard = await page.locator('.tab-btn, #meetings-container').isVisible().catch(() => false)
  if (isDashboard) return

  const loginBtn = page.locator('a[href*="/auth/zoho"], button:has-text("Sign in")')
  await loginBtn.waitFor({ timeout: 15000 })
  await loginBtn.click()

  await page.waitForURL(/accounts\.zoho\.com/, { timeout: 20000 })
  await page.fill('input[name="LOGIN_ID"], input[type="email"]', credentials.email)
  await page.click('button#nextbtn, button[type="submit"], #signin-submit')

  await page.waitForSelector('input[type="password"]', { timeout: 15000 })
  await page.fill('input[type="password"]', credentials.password)
  await page.click('button#signin-submit, button[type="submit"]')

  await page.waitForURL(url => url.toString().startsWith(BASE_URL), { timeout: 30000 })
  await page.waitForLoadState('domcontentloaded')
}

function ensureAuthDir() {
  const dir = path.dirname(AUTH_STATE_PATH)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
}

async function apiGetMeetings(request) {
  const res = await request.get(`${BASE_URL}/api/meetings`)
  return res.ok() ? res.json() : []
}

async function apiCreateMeeting(request, overrides = {}) {
  const defaults = { title: `Test Meeting ${Date.now()}` }
  const payload  = { ...defaults, ...overrides }
  const res      = await request.post(`${BASE_URL}/api/meetings`, {
    data: JSON.stringify(payload),
    headers: { 'Content-Type': 'application/json' },
  })
  return res.ok() ? res.json() : null
}

async function apiDeleteMeeting(request, meetingId) {
  await request.delete(`${BASE_URL}/api/meetings/${meetingId}`)
}

async function apiEndMeeting(request, meetingId) {
  await request.post(`${BASE_URL}/api/meetings/${meetingId}/end`)
}

async function waitForDashboard(page) {
  await page.waitForSelector('.tab-btn', { timeout: 20000 })
  await page.waitForLoadState('networkidle')
}

async function clickTab(page, label) {
  await page.locator(`.tab-btn:has-text("${label}")`).click()
  await page.waitForTimeout(300)
}

async function openScheduleModal(page) {
  await page.locator('button:has-text("Schedule"), .btn-primary:has-text("Schedule")').first().click()
  await page.waitForSelector('#schedModal.open, .modal-overlay.open', { timeout: 10000 })
}

async function openStartNowModal(page) {
  await page.locator('button:has-text("Start Now"), .btn-secondary:has-text("Start")').first().click()
  await page.waitForSelector('#startNowModal.open, .modal-overlay.open', { timeout: 10000 })
}

async function closeModal(page) {
  await page.locator('.modal-overlay.open .btn-cancel').click()
  await page.waitForTimeout(300)
}

module.exports = {
  CREDENTIALS, AUTH_STATE_PATH, ensureAuthDir, loginWithZoho,
  apiGetMeetings, apiCreateMeeting, apiDeleteMeeting, apiEndMeeting,
  waitForDashboard, clickTab, openScheduleModal, openStartNowModal, closeModal,
}
