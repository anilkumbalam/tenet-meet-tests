// 57 - Company settings (8 Nov, company.js): one place for company-specific values; nothing changes for Tenet.
//  - GET /api/company (open): product name, logo, staff domains; nothing else from settings (no mail settings).
//  - Planned co-host still keeps only staff addresses (now via company.isStaffEmail).
//  The "Tenet staff only" automatic co-host rule and "staff first" ordering are covered by the existing co-host tests.
const { test, expect, request } = require('@playwright/test')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const HOST = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const DOMAIN = HOST.split('@')[1]
const api = email => request.newContext({ baseURL: BASE, extraHTTPHeaders: { cookie: 'meet_token=' + jwt.sign({ email, displayName: 'T57', isAdmin: email === HOST }, KEY, { expiresIn: '1h' }) } })

test.describe('57 - Company settings', () => {

  test('GET /api/company: open, Tenet values, only the public fields', async () => {
    const anon = await request.newContext({ baseURL: BASE })
    const r = await anon.get('/api/company')
    expect(r.status()).toBe(200)
    const c = await r.json()
    expect(Object.keys(c).sort()).toEqual(['brandFirst', 'brandSecond', 'colour', 'domains', 'logo', 'name', 'product'])
    expect(c.product).toBe('Tenet Meet')
    expect(c.domains).toContain(DOMAIN)
    expect(JSON.stringify(c)).not.toMatch(/smtp|pass|secret/i)
    await anon.dispose()
  })

  test('planned co-host keeps only staff addresses', async () => {
    const host = await api(HOST)
    const staff = 'pw57@' + DOMAIN, outside = 'guest57@example.com'
    const r = await host.post('/api/meetings', { data: { title: 'T57 planned ' + Date.now(), invited_emails: staff + ',' + outside, planned_cohosts: staff + ',' + outside } })
    expect(r.ok()).toBe(true)
    const m = await r.json()
    try {
      expect(m.planned_cohosts).toBe(staff)
    } finally { await host.delete('/api/meetings/' + m.id) }
    await host.dispose()
  })
})
