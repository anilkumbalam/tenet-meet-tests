// 63 - Who can do what (9 Nov). Every protected route is called as each kind of person; those who must not be able
// to do something must be refused (401/403, or 404 = "not yours to see", or a redirect to sign-in), and a refused
// call must change nothing. Any server error (5xx) fails. Answers we have no fixed rule for yet are printed in the
// table ("note") for Anil to decide, not failed.
// People: out (no sign-in), member (staff, not invited), invited (staff, invited), host (staff, not admin, owns the
// meeting), other host (owns another meeting), admin. The meeting under test is open (started), with the waiting room on.
const { test, expect, request } = require('./guard')
const jwt = require('jsonwebtoken')
const H = require('./meet-helpers')
let ENV = {}; try { ENV = require('./env') } catch (e) {}
const KEY = H.JWT_SECRET || process.env.JWT_SECRET || ENV.JWT_SECRET
const BASE = H.BASE_URL || ENV.BASE_URL
const ADMIN = process.env.HOST_EMAIL || 'anil@tenetnetworks.com'
const RUN = Date.now().toString(36)
const WHO = {
  host:    { email: 'pw-host63@tenetnetworks.com',   name: 'PW Host 63',   isAdmin: false },
  member:  { email: 'pw-member63@tenetnetworks.com', name: 'PW Member 63', isAdmin: false },
  invited: { email: 'pw-member55@tenetnetworks.com', name: 'PW Member 55', isAdmin: false },   // a real test mailbox (invites are emailed)
  admin:   { email: ADMIN, name: H.HOST_DISPLAY || 'Admin', isAdmin: true },
}
const pass = w => jwt.sign({ email: w.email, displayName: w.name, isAdmin: w.isAdmin }, KEY, { expiresIn: '30m' })
const ctx = w => request.newContext({ baseURL: BASE, ignoreHTTPSErrors: true, maxRedirects: 0, extraHTTPHeaders: w ? { cookie: 'meet_token=' + pass(w) } : {} })

const REFUSED = s => [401, 403, 404].includes(s) || ((s === 302 || s === 303))
const rows = [], problems = []
function judge (who, method, path, status, rule) {
  // rule: 'refuse' (2xx fails), 'strict' (must be 401/403/redirect), 'note' (printed only)
  let verdict = 'ok'
  if (status >= 500) verdict = 'FAIL (server error)'
  else if (rule === 'strict' && !([401, 403, 302, 303].includes(status))) verdict = 'FAIL (must be refused before anything else)'
  else if (rule === 'refuse' && status >= 200 && status < 300) verdict = 'FAIL (allowed!)'
  else if (rule === 'refuse' && !REFUSED(status)) verdict = 'warn (' + status + ': looked at the request before the rights)'
  else if (rule === 'note') verdict = 'note'
  rows.push({ who, call: method + ' ' + path, status, verdict })
  if (verdict.startsWith('FAIL')) problems.push(who + ': ' + method + ' ' + path + ' -> ' + status + ' ' + verdict)
}
async function call (c, method, path, data) {
  const r = await c.fetch(path, { method, data, failOnStatusCode: false })
  return r.status()
}

test.describe.serial('63 - Who can do what', () => {
  test.setTimeout(180000)
  const C = {}
  let T, A                                            // T: pw-host63's open meeting; A: the admin's own meeting
  test.beforeAll(async () => {
    C.out = await ctx(null); for (const k of Object.keys(WHO)) C[k] = await ctx(WHO[k])
    const mk = async (c, title, extra) => { const r = await c.post('/api/meetings', { data: Object.assign({ title, duration_minutes: 30 }, extra) }); expect(r.ok(), 'create ' + title + ' (' + r.status() + ')').toBe(true); return r.json() }
    T = await mk(C.host, 'T63 host ' + RUN, {})
    A = await mk(C.admin, 'T63 admin ' + RUN, {})
    const wr = await C.host.patch('/api/meetings/' + T.id, { data: { waiting_room: 1, invited_emails: WHO.invited.email } })
    expect(wr.ok(), 'host sets the waiting room and the invite (' + wr.status() + ')').toBe(true)
    await C.host.post('/api/meetings/' + T.id + '/start')
  })
  test.afterAll(async () => {
    for (const m of [T, A]) if (m) { await C.admin.post('/api/meetings/' + m.id + '/end').catch(() => {}); await C.admin.delete('/api/meetings/' + m.id).catch(() => {}) }
    console.log('[63] who can do what:\n' + rows.map(r => '  ' + r.who.padEnd(8) + ' ' + r.call.padEnd(52) + ' ' + String(r.status).padEnd(4) + ' ' + r.verdict).join('\n'))
    for (const c of Object.values(C)) await c.dispose().catch(() => {})
  })

  const onMeeting = [                               // [method, path after /api/meetings/:id, body]
    ['PATCH', '', { title: 'T63 changed' }], ['POST', '/lock', { locked: true }],
    ['POST', '/moderator', { identity: 'nobody' }], ['DELETE', '/moderator', {}],
    ['POST', '/mute/nobody', {}], ['POST', '/kick/nobody', {}], ['POST', '/stop-share/nobody', {}],
    ['POST', '/waiting-room', { enabled: 0 }], ['POST', '/waiting/admit', { id: 1 }], ['POST', '/waiting/deny', { id: 1 }],
    ['POST', '/waiting/message', { text: 'x' }], ['POST', '/send-back/nobody', {}], ['POST', '/finish/nobody', {}],
    ['POST', '/files-enabled', { enabled: 0 }],
    ['POST', '/cancel', {}], ['POST', '/end', {}], ['DELETE', '', {}],          // the drastic ones last
  ]

  test('people who must not manage a meeting are refused, and nothing changes', async () => {
    for (const who of ['out', 'member', 'invited']) {
      for (const [m, p, body] of onMeeting) judge(who, m, '/api/meetings/:id' + p, await call(C[who], m, '/api/meetings/' + T.id + p, body), 'refuse')
    }
    for (const [m, p, body] of onMeeting) judge('host', m, "/api/meetings/:id" + p + " (admin's meeting)", await call(C.host, m, '/api/meetings/' + A.id + p, body), 'refuse')
    const all = await (await C.admin.get('/api/meetings')).json().catch(() => [])
    const after = all.find(m => m.id === T.id) || {}
    expect.soft(after.id, 'meeting still there').toBe(T.id)
    expect.soft(after.title, 'title unchanged').toBe(T.title)
    expect.soft(after.status, 'still open').toBe('active')
    if ('waiting_room' in after) expect.soft(Number(after.waiting_room), 'waiting room still on').toBe(1)
    for (const k of ['locked', 'is_locked']) if (k in after) expect.soft(Boolean(Number(after[k])), 'not locked').toBe(false)
    const a2 = all.find(m => m.id === A.id) || {}
    expect.soft(a2.title, "admin's meeting unchanged").toBe(A.title)
    expect.soft(['scheduled', 'active'].includes(a2.status), "admin's meeting not cancelled or ended (" + a2.status + ')').toBe(true)
    expect.soft(problems, 'refused calls').toEqual([])
  })

  test('reading a meeting: the waiting list, people and files', async () => {
    for (const who of ['out', 'member']) for (const p of ['/waiting', '/participants', '/files']) judge(who, 'GET', '/api/meetings/:id' + p, await call(C[who], 'GET', '/api/meetings/' + T.id + p), 'refuse')
    for (const p of ['/waiting', '/participants', '/files']) judge('invited', 'GET', '/api/meetings/:id' + p, await call(C.invited, 'GET', '/api/meetings/' + T.id + p), 'refuse')   // 9 Nov (Anil): host tools, refused from outside the meeting
    for (const who of ['out', 'invited']) {                     // status is open (guests' pages need it) but tells only whether the meeting is on
      const r = await C[who].get('/api/meetings/' + T.id + '/status'); judge(who, 'GET', '/api/meetings/:id/status', r.status(), 'note')
      expect.soft(Object.keys(await r.json().catch(() => ({}))), who + ': status tells only the state').toEqual(['status'])
    }
    for (const p of ['/waiting', '/participants']) { const s = await call(C.host, 'GET', '/api/meetings/' + T.id + p); judge('host', 'GET', '/api/meetings/:id' + p, s, 'note'); expect.soft(s, 'host can read ' + p).toBe(200) }
    expect.soft(problems, 'reading').toEqual([])
  })

  test('meeting lists show only your own meetings, and waiting names only to the host', async () => {
    const list = async who => { const r = await C[who].get('/api/meetings?with=invited'); return { s: r.status(), body: r.ok() ? await r.json() : [] } }
    const out = await list('out'); judge('out', 'GET', '/api/meetings?with=invited', out.s, 'strict')
    const mem = await list('member'), inv = await list('invited'), host = await list('host')
    expect.soft(mem.body.some(m => m.id === T.id), 'a staff member who is not invited does not see the meeting').toBe(false)
    expect.soft(inv.body.some(m => m.id === T.id), 'the invited member sees the meeting').toBe(true)
    const ti = inv.body.find(m => m.id === T.id) || {}
    expect.soft('waiting_names' in ti, 'the invited member does not get the names of waiting guests').toBe(false)
    expect.soft(host.body.some(m => m.id === A.id), "a host who is not admin does not see the admin's meeting").toBe(false)
    const th = host.body.find(m => m.id === T.id) || {}
    expect.soft('waiting_count' in th, 'the host gets the waiting count').toBe(true)
    expect.soft(problems, 'lists').toEqual([])
  })

  test('admin pages refuse everyone but admins', async () => {
    const adminCalls = [['GET', '/api/users'], ['PATCH', '/api/users/999999/admin', { is_admin: 1 }], ['PATCH', '/api/users/999999/disable', { is_disabled: 1 }],
      ['DELETE', '/api/users/999999'], ['GET', '/api/system/settings'], ['POST', '/api/system/settings', {}]]
    for (const who of ['out', 'member', 'invited', 'host']) for (const [m, p, b] of adminCalls) judge(who, m, p, await call(C[who], m, p, b), 'strict')
    judge('admin', 'GET', '/api/users', await call(C.admin, 'GET', '/api/users'), 'note')
    const st = await C.admin.get('/api/system/settings')
    judge('admin', 'GET', '/api/system/settings', st.status(), 'note')
    if (st.ok()) {                                   // never print the values: only whether a mail password is sent to the page
      const j = await st.json().catch(() => ({})), flat = JSON.stringify(j)
      const shown = /smtp_pass"\s*:\s*"[^"•*]{3,}/.test(flat) || (Array.isArray(j) && j.some(x => /pass/i.test(x.key || x.name || '') && String(x.value || '').length > 2 && !/^[•*]+$/.test(x.value)))
      rows.push({ who: 'admin', call: 'settings answer contains the mail password', status: '', verdict: shown ? 'note: YES (sent to the browser)' : 'no' })
    }
    expect.soft(problems, 'admin pages').toEqual([])
  })
})
