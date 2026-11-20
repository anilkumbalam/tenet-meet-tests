// @ts-check
const { test, expect } = require('@playwright/test')
const H = require('./meet-helpers')
const BASE = H.BASE_URL
const DAY = 864e5
const CODE = ['SU','MO','TU','WE','TH','FR','SA']
const istDate = ms => new Date(ms + 5.5 * 3600e3).toISOString().slice(0, 10)
const wd  = s => new Date(String(s).slice(0,10) + 'T00:00:00Z').getUTCDay()
const dom = s => Number(String(s).slice(8,10))
const mon = s => Number(String(s).slice(5,7))
const dim = s => new Date(Number(String(s).slice(0,4)), Number(String(s).slice(5,7)), 0).getUTCDate()
test.describe('81 - recurrence v2 patterns', () => {
  test.describe.configure({ mode: 'serial' })
  const stamp = Date.now().toString(36)
  const date = istDate(Date.now() + 2 * DAY)
  const X = new Date(date + 'T00:00:00Z').getUTCDay()
  const created = []
  let api
  const mk = async (key, extra) => {
    const title = `T81 ${key} ${stamp}`
    const r = await api.request.post(`${BASE}/api/meetings`, { data: Object.assign({ title, scheduled_at: date + 'T10:00', duration_minutes: 30, timezone: 'Asia/Kolkata' }, extra) })
    expect(r.ok(), 'create ' + key).toBeTruthy()
    const m = await r.json(); created.push(m.id); return m
  }
  const detail  = async id => (await api.request.get(`${BASE}/api/admin/meetings/${id}`)).json()
  const preview = async body => (await api.request.post(`${BASE}/api/meetings/preview-occurrences`, { data: body })).json()
  test.beforeAll(async ({ browser }) => { api = await browser.newContext({ ignoreHTTPSErrors: true }); await H.setAuthCookie(api) })
  test.afterAll(async () => {
    const list = await api.request.get(`${BASE}/api/admin/meetings?period=90d`).then(r => r.json()).catch(() => ({ meetings: [] }))
    for (const m of (list.meetings || []).filter(x => String(x.title).startsWith('T81 ') && String(x.title).endsWith(stamp))) created.push(m.id)
    for (const id of new Set(created)) await api.request.delete(`${BASE}/api/meetings/${id}`).catch(() => {})
    await api.close()
  })
  test('1st Monday: stored rule + preview', async () => {
    const m = await mk('firstMon', { freq: 'monthly', monthlyBy: 'weekday', setpos: [{ ord: '1', day: 'MO' }] })
    expect((await detail(m.id)).meeting.recurrence_rrule).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO')
    const occ = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'monthly', monthlyBy: 'weekday', setpos: [{ ord: '1', day: 'MO' }], limit: 5 })).occurrences
    for (const o of occ.slice(1)) { expect(wd(o.local)).toBe(1); expect(dom(o.local)).toBeLessThanOrEqual(7) }
  })
  test('last Friday of month: stored rule + preview', async () => {
    const m = await mk('lastFri', { freq: 'monthly', monthlyBy: 'weekday', setpos: [{ ord: '-1', day: 'FR' }] })
    expect((await detail(m.id)).meeting.recurrence_rrule).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=-1FR')
    const occ = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'monthly', monthlyBy: 'weekday', setpos: [{ ord: '-1', day: 'FR' }], limit: 5 })).occurrences
    for (const o of occ.slice(1)) { expect(wd(o.local)).toBe(5); expect(dom(o.local)).toBeGreaterThan(dim(o.local) - 7) }
  })
  test('quarterly last Friday: stored rule + preview months', async () => {
    const m = await mk('qtrLastFri', { freq: 'quarterly', quarterEnd: true, setpos: [{ ord: '-1', day: 'FR' }] })
    expect((await detail(m.id)).meeting.recurrence_rrule).toBe('FREQ=YEARLY;BYMONTH=3,6,9,12;BYDAY=-1FR')
    const occ = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'quarterly', quarterEnd: true, setpos: [{ ord: '-1', day: 'FR' }], limit: 4 })).occurrences
    for (const o of occ.slice(1)) { expect([3,6,9,12]).toContain(mon(o.local)); expect(wd(o.local)).toBe(5) }
  })
  test('biweekly Wednesday: stored rule + 14-day gaps', async () => {
    const m = await mk('biweekly', { freq: 'weekly', interval: 2, weekdays: ['WE'] })
    expect((await detail(m.id)).meeting.recurrence_rrule).toBe('FREQ=WEEKLY;INTERVAL=2;WKST=MO;BYDAY=WE')
    const occ = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'weekly', interval: 2, weekdays: ['WE'], limit: 4 })).occurrences
    for (let i = 2; i < occ.length; i++) expect((Date.parse(occ[i].local.slice(0,10)) - Date.parse(occ[i-1].local.slice(0,10))) / DAY).toBe(14)
  })
  test('weekly + skip: promoted to a rule, skipped date gone', async () => {
    const dayCode = CODE[X]
    const base = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'weekly', weekdays: [dayCode], limit: 5 })).occurrences
    const skipDay = base[2].local.slice(0,10)
    const m = await mk('weeklySkip', { freq: 'weekly', weekdays: [dayCode], recurrence_skip_dates: skipDay })
    const d = (await detail(m.id)).meeting
    expect(d.recurrence_rrule).toContain('FREQ=WEEKLY')
    expect(String(d.recurrence_skip_dates)).toBe(skipDay)
    const occ = (await preview({ scheduled_at: date + ' 10:00', timezone: 'Asia/Kolkata', freq: 'weekly', weekdays: [dayCode], recurrence_skip_dates: skipDay, limit: 5 })).occurrences
    expect(occ.some(o => o.local.slice(0,10) === skipDay)).toBe(false)
  })
  test('spawn: ending a 1st-Monday occurrence creates the next 1st Monday', async () => {
    const m = await mk('spawn', { freq: 'monthly', monthlyBy: 'weekday', setpos: [{ ord: '1', day: 'MO' }] })
    await api.request.patch(`${BASE}/api/meetings/${m.id}`, { data: { status: 'ended' } })
    await expect.poll(async () => {
      const list = await api.request.get(`${BASE}/api/admin/meetings?period=90d`).then(r => r.json()).catch(() => ({ meetings: [] }))
      const n = (list.meetings || []).find(x => x.title === `T81 spawn ${stamp}` && x.status === 'scheduled' && x.id !== m.id)
      return n ? n.scheduled_at : null
    }, { timeout: 90000, intervals: [3000] }).not.toBeNull()
  })
  test('spawned next is a genuine 1st Monday, rule carried', async () => {
    const list = await api.request.get(`${BASE}/api/admin/meetings?period=90d`).then(r => r.json())
    const n = (list.meetings || []).find(x => x.title === `T81 spawn ${stamp}` && x.status === 'scheduled')
    expect(n, 'spawned child exists').toBeTruthy()
    created.push(n.id)
    expect(wd(n.scheduled_at)).toBe(1)
    expect(dom(n.scheduled_at)).toBeLessThanOrEqual(7)
    expect(n.recurrence_rrule).toBe('FREQ=MONTHLY;INTERVAL=1;BYDAY=1MO')
  })
})
