// Runs once after every Playwright run: deletes the meetings the tests created, so the dashboard does not fill up
// with test meetings between the nightly clean-ups. Only meetings whose title has a test shape (same rules as
// deploy/maintenance/purge-test-meetings.sh) and that are not running are deleted; real meetings are never touched.
const { request } = require('@playwright/test')
const jwt = require('jsonwebtoken')
const { BASE_URL } = require('./tests/env')

const TEST_TITLE = [/^[a-z][a-z0-9-]*-[a-z0-9]{7,9}$/, /^API Title Test[ _-][A-Za-z0-9]{4,16}$/, /^Quick[ _-][a-z0-9]{4,16}$/,
  /^Ended Test [0-9]{13}$/, /^renamed by (admin|its host)$/, /^(API Title Test|Get Test|debug-cohost)$/]
const IF_NOBODY_JOINED = ['Quick Meeting', 'test']

module.exports = async () => {
  const secret = process.env.JWT_SECRET
  if (!secret) { console.log('[cleanup] JWT_SECRET not set, test meetings left for the nightly clean-up'); return }
  const tok = jwt.sign({ email: process.env.HOST_EMAIL || 'anil@tenetnetworks.com', displayName: 'Test clean-up', isAdmin: 1 }, secret, { expiresIn: '10m' })
  const api = await request.newContext({ ignoreHTTPSErrors: true, extraHTTPHeaders: { Cookie: 'meet_token=' + tok } })
  let removed = 0, failed = 0
  try {
    const r = await api.get(`${BASE_URL}/api/meetings`)
    if (!r.ok()) { console.log('[cleanup] could not list meetings:', r.status()); return }
    for (const m of await r.json()) {
      const t = String(m.title || '')
      const isTest = TEST_TITLE.some(rx => rx.test(t)) || (IF_NOBODY_JOINED.includes(t) && Number(m.participant_count || 0) === 0)
      if (!isTest || m.status === 'active' || (m.recurrence && m.recurrence !== 'none')) continue
      const d = await api.delete(`${BASE_URL}/api/meetings/${m.id}`)
      if (d.ok()) removed++; else failed++
    }
    console.log(`[cleanup] removed ${removed} test meetings` + (failed ? `, ${failed} could not be removed` : ''))
  } catch (e) { console.log('[cleanup] skipped:', e.message) }
  finally { await api.dispose() }
}
