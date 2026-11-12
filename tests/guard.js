// Suite-wide watch (8 Nov 2026): every test is checked for problems the test itself does not look for:
//   - uncaught script errors on any page (pageerror),
//   - console errors (except the browser's own "Failed to load resource" lines: 4xx answers are often expected),
//   - server errors (HTTP 5xx) on any request the pages make.
// It watches the built-in page/context, contexts made with browser.newContext(), and browsers launched by
// meet-helpers.js (chromium/firefox/webkit.launch are wrapped).
// Mode (env GUARD): 'report' (default) = never fails, writes /root/guard-report.jsonl and prints a summary line per
// test; 'fail' = a test with problems fails. A test that provokes errors on purpose adds
//   test.info().annotations.push({ type: 'guard-allow', description: '<regex>' })
// Undo: in tests/*.spec.js replace require('./guard') with require('@playwright/test') again.
const base = require('@playwright/test')
const fs = require('fs')

const MODE = process.env.GUARD || 'report'
const REPORT = process.env.GUARD_REPORT || '/root/guard-report.jsonl'
// 9 Nov: the media library prints 'Unknown DataChannel error on lossy/reliable' when the server closes a call
// (meeting ended, person removed); it is not a fault and people never see it.
const IGNORE = [/ResizeObserver loop/i, /^Failed to load resource/i, /favicon\.ico/i, /^Unknown DataChannel error on (lossy|reliable)\b/i,
  /^Tried to add a track for a participant, that's not present/i,   // 9 Nov: library timing race on let in again; test 62 shows sound still flows
  /The play\(\) request was interrupted/i]   // 10 Nov: a video torn down while it is still starting (leaving); a browser message, not ours
// 9 Nov: messages that particular tests cause on purpose (they cut the network, or make the server refuse)
const EXPECTED = [
  { file: /^14-connection-roles\./, test: /connection lost/i, msg: /^WebSocket connection to|^Failed to fetch/ },
  { file: /^19-mobile\./, test: /network drop/i, msg: /^WebSocket connection to|^Failed to fetch/ },
  { file: /^55-dashboard-v4\./, test: /refused cancel/i, msg: /\/cancel$/ },   // the test answers 500 itself
  { file: /^(14-connection-roles|19-mobile|69-people-agree)\./, test: /drop|connection lost/i, msg: /^Internal error\b|ConnectionError/ },   // 10 Nov: one failed attempt while getting back in after a cut network
]
const hide = s => String(s || '').replace(/(access_token|token)=[^&\s'"]+/gi, '$1=…')   // never keep sign-in or room passes in the report
let found = []

function note (kind, where, msg) { found.push({ kind, where: hide(where).slice(0, 200), msg: hide(msg).slice(0, 900) }) }
function watchPage (p) {
  if (!p || p.__guard) return; p.__guard = true
  p.on('pageerror', e => note('page error', p.url(), (e && (e.stack || e.message)) || e))   // 9 Nov: keep where it happened
  p.on('console', m => { if (m.type() === 'error') note('console error', p.url(), m.text()) })
  p.on('response', r => { if (r.status() >= 500) note('server ' + r.status(), r.url(), r.request().method() + ' ' + r.url()) })
}
function watchContext (c) {
  if (!c || c.__guard) return c; c.__guard = true
  c.pages().forEach(watchPage); c.on('page', watchPage); return c
}
function watchBrowser (b) {
  if (!b || b.__guard) return b; b.__guard = true
  const nc = b.newContext.bind(b); b.newContext = async (...a) => watchContext(await nc(...a))
  const np = b.newPage.bind(b); b.newPage = async (...a) => { const p = await np(...a); watchContext(p.context()); watchPage(p); return p }
  b.contexts().forEach(watchContext)
  return b
}
for (const t of [base.chromium, base.firefox, base.webkit]) {
  if (t.__guard) continue; t.__guard = true
  const l = t.launch.bind(t); t.launch = async (...a) => watchBrowser(await l(...a))
}

const test = base.test.extend({
  context: async ({ context }, use) => { watchContext(context); await use(context) },
  page: async ({ page }, use) => { watchPage(page); await use(page) },
  _guard: [async ({ browser }, use, info) => {
    watchBrowser(browser); found = []
    const ow = console.warn, ol = console.log, soft = /could not|known limitation|loading screen timeout|skipp|not installed|cannot start/i   // 9 Nov: no quiet soft spots
    console.warn = (...a) => { note('test warning', info.title, a.map(String).join(' ')); ow(...a) }
    console.log = (...a) => { const t = a.map(String).join(' '); if (soft.test(t)) note('test warning', info.title, t); ol(...a) }
    try { await use() } finally { console.warn = ow; console.log = ol }
    if (info.status === 'skipped') note('skipped', info.title, 'the test was skipped')
    const allow = info.annotations.filter(a => a.type === 'guard-allow').map(a => new RegExp(a.description, 'i'))
    const fileName = info.file.split('/').pop()
    const meant = EXPECTED.filter(x => x.file.test(fileName) && x.test.test(info.title)).map(x => x.msg)
    const bad = found.filter(f => !IGNORE.some(r => r.test(f.msg)) && !meant.some(r => r.test(f.msg)) && !allow.some(r => r.test(f.msg) || r.test(f.where)))
    if (!bad.length) return
    const line = { at: new Date().toISOString(), file: info.file.split('/').pop(), test: info.title, problems: bad.slice(0, 20) }
    try { fs.appendFileSync(REPORT, JSON.stringify(line) + '\n') } catch (e) {}
    console.log('[guard] ' + line.file + ' › ' + info.title + ': ' + bad.length + ' problem(s): ' + bad.slice(0, 3).map(b => b.kind + ': ' + b.msg.slice(0, 120)).join(' | '))
    if (MODE === 'fail') throw new Error('[guard] ' + bad.length + ' problem(s) on the pages during this test:\n' + bad.map(b => '  ' + b.kind + ' @ ' + b.where + '\n    ' + b.msg).join('\n'))
  }, { auto: true }]
})

module.exports = Object.assign({}, base, { test })
