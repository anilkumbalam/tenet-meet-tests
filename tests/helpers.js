const { BASE_URL } = require('./env')
const path = require('path')
const fs   = require('fs')
const crypto = require('crypto')

const CREDENTIALS = {
  primary: {
    email: process.env.MEET_USER || 'anil@tenetnetworks.com',
  },
}

const AUTH_STATE_PATH = path.join(__dirname, '..', '.auth', 'user.json')
const JWT_SECRET = process.env.JWT_SECRET

function makeJwt(payload, secret, expiresIn = 8 * 3600) {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')
  const now = Math.floor(Date.now() / 1000)
  const claims = { ...payload, iat: now, exp: now + expiresIn }
  const body = Buffer.from(JSON.stringify(claims)).toString('base64url')
  const sig = crypto.createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url')
  return `${header}.${body}.${sig}`
}

async function loginWithZoho(page, credentials = CREDENTIALS.primary) {
  const token = makeJwt(
    { email: credentials.email, displayName: credentials.email.split('@')[0], isAdmin: 1 },
    JWT_SECRET
  )
  const domain = new URL(BASE_URL).hostname

  await page.context().addCookies([{
    name: 'meet_token',
    value: token,
    domain,
    path: '/',
    httpOnly: true,
    secure: true,
    sameSite: 'Lax',
  }])

  await page.goto(BASE_URL + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(2000)
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
  const defaults = { title: `tm-${Date.now().toString(36)}` }
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
  CREDENTIALS, AUTH_STATE_PATH, JWT_SECRET, makeJwt, ensureAuthDir, loginWithZoho,
  apiGetMeetings, apiCreateMeeting, apiDeleteMeeting, apiEndMeeting,
  waitForDashboard, clickTab, openScheduleModal, openStartNowModal, closeModal,
}
