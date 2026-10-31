// 21 - Outside checks: the site as an attacker on the internet sees it (no login).
// Every staff / admin address refuses outsiders; forged, expired or unsigned staff passes are refused;
// a guest's participant key unlocks nothing staff-only; internal ports are closed; source and secret files
// are not reachable; security headers are present; injection-shaped input gives no database errors.
// Ownership: only the host or an admin manages a meeting; only the host or co-host removes people in it.
const { test, expect, request } = require('@playwright/test')
const net = require('net'), dns = require('dns').promises
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')

let meetingId, roomUuid, api, out
const host = new URL(H.BASE_URL).hostname
const refused = s => s === 401 || s === 403

test.describe.serial('21 - Outside checks', () => {

  test.setTimeout(120000)

  test.beforeAll(async ({ browser }) => {
    out = await request.newContext({ ignoreHTTPSErrors: true, maxRedirects: 0 })
    ;({ meetingId, roomUuid, api } = await H.createMeeting(browser, 'outside'))
  })
  test.afterAll(async () => {
    if (meetingId && api) await api.request.post(`${H.BASE_URL}/api/meetings/${meetingId}/cancel`).catch(() => {})
    if (api) await api.close().catch(() => {})
    if (out) await out.dispose().catch(() => {})
  })

  test('staff and admin addresses refuse outsiders', async () => {
    const id = meetingId, B = H.BASE_URL
    const calls = [
      ['get', '/api/meetings'], ['post', '/api/meetings'], ['patch', `/api/meetings/${id}`], ['delete', `/api/meetings/${id}`],
      ['post', `/api/meetings/${id}/join`], ['post', `/api/meetings/${id}/start`], ['post', `/api/meetings/${id}/cancel`],
      ['post', `/api/meetings/${id}/leave`], ['post', `/api/meetings/${id}/host-rejoined`], ['post', `/api/meetings/${id}/lock`],
      ['post', `/api/meetings/${id}/kick/someone`], ['post', `/api/meetings/${id}/moderator`], ['delete', `/api/meetings/${id}/moderator`],
      ['get', `/api/meetings/${id}/participants`], ['get', '/api/users'], ['patch', '/api/users/1/admin'], ['patch', '/api/users/1/disable'],
      ['delete', '/api/users/1'], ['get', '/api/system/status'], ['get', '/api/system/settings'], ['post', '/api/system/settings'],
      ['get', '/auth/me'], ['get', '/api/me'],
    ]
    const bad = []
    for (const [m, p] of calls) { const s = (await out[m](B + p, m === 'get' ? {} : { data: {} })).status(); if (refused(s) === false) bad.push(`${m.toUpperCase()} ${p} -> ${s}`) }
    expect(bad, 'addresses that did not refuse an outsider').toEqual([])
    const d = await out.get(`${B}/dashboard`, { headers: { Accept: 'text/html' } })
    expect([302, 303]).toContain(d.status())
    expect(d.headers().location || '').toContain('/start')
    expect((await H.meetingStatus(api, id)).status, 'meeting untouched').not.toBe('ended')
  })

  test('forged, expired and unsigned staff passes are refused', async () => {
    const claims = { email: H.HOST_EMAIL, displayName: 'Forged', isAdmin: 1 }
    const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url')
    const passes = {
      'wrong secret': jwt.sign(claims, 'not-the-real-secret', { expiresIn: '1h' }),
      'unsigned (alg none)': b64({ alg: 'none', typ: 'JWT' }) + '.' + b64({ ...claims, exp: Math.floor(Date.now() / 1000) + 3600 }) + '.',
      'garbage': 'abc.def.ghi',
    }
    if (process.env.JWT_SECRET) passes['expired'] = jwt.sign({ ...claims, exp: Math.floor(Date.now() / 1000) - 60 }, process.env.JWT_SECRET)
    for (const [what, tok] of Object.entries(passes)) {
      for (const p of ['/api/meetings', '/api/users', '/auth/me']) {
        const s = (await out.get(H.BASE_URL + p, { headers: { Cookie: 'meet_token=' + tok } })).status()
        expect(refused(s), `${what} pass on ${p} -> ${s}`).toBe(true)
      }
    }
  })

  test('a guest key unlocks nothing staff-only', async () => {
    const host1 = await H.joinAsHost(meetingId)
    const guest = await H.joinAsGuest(roomUuid, 'Guest Probe')
    try {
      const s = await guest.page.evaluate(async id => {
        const r = {}
        for (const [m, p] of [['POST', '/lock'], ['POST', '/kick/x'], ['POST', '/moderator'], ['DELETE', '/moderator'], ['POST', '/cancel'], ['POST', '/start'], ['GET', '/participants'], ['DELETE', '']])
          r[m + ' ' + (p || '/')] = (await fetch('/api/meetings/' + id + p, { method: m, headers: { 'Content-Type': 'application/json' }, body: m === 'GET' ? undefined : '{}' })).status
        r['GET /api/users'] = (await fetch('/api/users')).status
        return r
      }, meetingId)
      const bad = Object.entries(s).filter(([, v]) => refused(v) === false)
      expect(bad, 'guest got through ' + JSON.stringify(s)).toEqual([])
      expect((await H.meetingStatus(api, meetingId)).status).toBe('active')
    } finally { await guest.browser.close().catch(() => {}); await host1.browser.close().catch(() => {}) }
  })

  test('only web ports are open (database, LiveKit API, Node app are not reachable)', async () => {
    const ip = (await dns.lookup(host)).address
    const probe = port => new Promise(res => {
      const s = net.connect({ host: ip, port, timeout: 3000 })
      s.on('connect', () => { s.destroy(); res('OPEN') }); s.on('timeout', () => { s.destroy(); res('closed') }); s.on('error', () => res('closed'))
    })
    const open = []
    for (const p of [3306, 33060, 6379, 7880, 3000, 3001, 3002, 8080, 8443, 9090]) if (await probe(p) === 'OPEN') open.push(p)
    expect(open, `ports open on ${ip}`).toEqual([])
    expect(await probe(443)).toBe('OPEN')
  })

  test('source, secret and backup files are not reachable', async () => {
    const paths = ['/.env', '/.git/config', '/.git/HEAD', '/server.js', '/moderation.js', '/package.json', '/package-lock.json',
      '/server.js.bak', '/public/.env', '/js/..%2f..%2fserver.js', '/%2e%2e/server.js', '/js/%2e%2e/%2e%2e/.env', '/deploy/nginx/meet.tenetnetworks.com']
    const bad = []
    for (const p of paths) {
      const r = await out.get(H.BASE_URL + p)
      const body = r.status() === 200 ? await r.text() : ''
      if (r.status() === 200 && /JWT_SECRET|DB_PASSWORD|LIVEKIT|require\(|"dependencies"|\[core\]/.test(body)) bad.push(p + ' -> ' + r.status())
    }
    expect(bad, 'files served').toEqual([])
  })

  test('security headers are present', async () => {
    for (const p of ['/start', `/join/${roomUuid}`, '/meeting/abc']) {
      const h = (await out.get(H.BASE_URL + p)).headers()
      expect(h['strict-transport-security'] || '', p + ' HSTS').toContain('max-age=')
      expect(h['x-content-type-options'], p + ' nosniff').toBe('nosniff')
      expect(Boolean(h['x-frame-options'] || /frame-ancestors/.test(h['content-security-policy'] || h['content-security-policy-report-only'] || '')), p + ' framing rule').toBe(true)
      expect(h['x-powered-by'], p + ' no server banner').toBeUndefined()
    }
  })

  test('injection-shaped input: no server errors, no database messages', async () => {
    const B = H.BASE_URL, q = encodeURIComponent
    const tries = [
      ['get', `/api/meetings/${q("1' OR '1'='1")}/status`], ['get', `/api/meetings/${q('1;DROP TABLE meetings')}/status`],
      ['get', `/api/room/${q("x' OR 1=1 -- ")}`], ['post', `/api/guest-join/${q("x' OR '1'='1")}`, { display_name: "Robert'); DROP TABLE participants;--" }],
      ['post', `/api/heartbeat/${q("1 OR 1=1")}?pk=${q("' OR '1'='1")}`], ['post', `/api/leave/${q("1 OR 1=1")}?pk=${q("' OR ''='")}`],
      ['get', `/join/${q('<script>alert(1)</script>')}`],
    ]
    const bad = []
    for (const [m, p, data] of tries) {
      const r = await out[m](B + p, data ? { data } : {})
      const body = await r.text()
      if (r.status() >= 500 || /ER_|SQL syntax|mysql|sqlMessage|<script>alert/i.test(body)) bad.push(`${m.toUpperCase()} ${p} -> ${r.status()} ${body.slice(0, 80)}`)
    }
    expect(bad).toEqual([])
    expect((await H.meetingStatus(api, meetingId)).status, 'meeting still there').toBeTruthy()
  })

  // Ownership: managing a meeting (edit, delete, start, cancel, participant list) is for its host or an admin;
  // removing someone in the meeting is for its host or co-host.
  for (const [what, m, p] of [['edit', 'patch', ''], ['delete', 'delete', ''], ['start', 'post', '/start'], ['cancel', 'post', '/cancel'], ['remove someone in', 'post', '/kick/x'], ['see participants of', 'get', '/participants']]) {
    test(`another staff member (not host, not admin) cannot ${what} someone else's meeting`, async ({ browser }) => {
      const ctx = await browser.newContext({ ignoreHTTPSErrors: true })
      await H.setAuthCookie(ctx, 'sec.probe@tenetnetworks.com', 'Sec Probe', false)
      const s = (await ctx.request[m](`${H.BASE_URL}/api/meetings/${meetingId}${p}`, m === 'get' ? {} : { data: { title: 'changed by probe' } })).status()
      await ctx.close()
      expect(refused(s), `${what} -> ${s}`).toBe(true)
      expect((await H.meetingStatus(api, meetingId)).status, 'meeting untouched').not.toBe('ended')
    })
  }

  test('a staff member manages their own meeting; an admin can manage anyone\'s', async ({ browser }) => {
    const probe = await browser.newContext({ ignoreHTTPSErrors: true })
    await H.setAuthCookie(probe, 'sec.probe@tenetnetworks.com', 'Sec Probe', false)
    const made = await probe.request.post(`${H.BASE_URL}/api/meetings`, { data: { title: 'probe-own-' + Date.now().toString(36), duration_minutes: 15 } })
    expect(made.ok()).toBe(true)
    const pm = await made.json()
    try {
      expect((await probe.request.patch(`${H.BASE_URL}/api/meetings/${pm.id}`, { data: { title: 'renamed by its host' } })).status(), 'host edits own').toBeLessThan(300)
      expect((await probe.request.get(`${H.BASE_URL}/api/meetings/${pm.id}/participants`)).status(), 'host lists own').toBe(200)
      // the admin (the test host account) manages a meeting it does not host
      expect((await api.request.patch(`${H.BASE_URL}/api/meetings/${pm.id}`, { data: { title: 'renamed by admin' } })).status(), 'admin edits (is ' + H.HOST_EMAIL + ' an admin?)').toBeLessThan(300)
      expect((await api.request.get(`${H.BASE_URL}/api/meetings/${pm.id}/participants`)).status(), 'admin lists').toBe(200)
      expect((await api.request.post(`${H.BASE_URL}/api/meetings/${pm.id}/cancel`)).status(), 'admin cancels').toBeLessThan(300)
    } finally {
      await probe.request.post(`${H.BASE_URL}/api/meetings/${pm.id}/cancel`).catch(() => {})
      await probe.close()
    }
  })
})
