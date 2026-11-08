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
const IGNORE = [/ResizeObserver loop/i, /^Failed to load resource/i, /favicon\.ico/i]
let found = []

function note (kind, where, msg) { found.push({ kind, where: String(where || '').slice(0, 200), msg: String(msg || '').slice(0, 400) }) }
function watchPage (p) {
  if (!p || p.__guard) return; p.__guard = true
  p.on('pageerror', e => note('page error', p.url(), (e && e.message) || e))
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
    await use()
    const allow = info.annotations.filter(a => a.type === 'guard-allow').map(a => new RegExp(a.description, 'i'))
    const bad = found.filter(f => !IGNORE.some(r => r.test(f.msg)) && !allow.some(r => r.test(f.msg) || r.test(f.where)))
    if (!bad.length) return
    const line = { at: new Date().toISOString(), file: info.file.split('/').pop(), test: info.title, problems: bad.slice(0, 20) }
    try { fs.appendFileSync(REPORT, JSON.stringify(line) + '\n') } catch (e) {}
    console.log('[guard] ' + line.file + ' › ' + info.title + ': ' + bad.length + ' problem(s): ' + bad.slice(0, 3).map(b => b.kind + ': ' + b.msg.slice(0, 120)).join(' | '))
    if (MODE === 'fail') throw new Error('[guard] ' + bad.length + ' problem(s) on the pages during this test:\n' + bad.map(b => '  ' + b.kind + ' @ ' + b.where + '\n    ' + b.msg).join('\n'))
  }, { auto: true }]
})

module.exports = Object.assign({}, base, { test })
