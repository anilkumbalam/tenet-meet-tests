import { test, expect } from '@playwright/test'
import { connectParticipant, waitForEventWhere, roomName } from '../helpers.js'
import env from '../env.js'

test('screen share publish and unsubscribe', async ({ browser }) => {
  const room = roomName('ss-test')
  const names = ['host', 'guest1', 'guest2', 'guest3']
  const pages = [], eventSets = []

  for (const identity of names) {
    const page = await browser.newPage()
    pages.push(page)
    await page.goto('about:blank')
    const events = await connectParticipant(page, room, identity, identity)
    eventSets.push(events)
  }

  await new Promise(r => setTimeout(r, 5000))

  await pages[1].evaluate(async () => {
    await window.__room.localParticipant.setScreenShareEnabled(true, {
      resolution: { width: 1280, height: 720, framerate: 5 }, simulcast: false,
    })
  })
  console.log('guest1 started screen share')

  const SCREEN = 'screen_share'
  await waitForEventWhere(eventSets[0], 'trackSubscribed',
    data => data && data.some(d => d && d.source === SCREEN), env.TRACK_TIMEOUT)
  console.log('host subscribed to screen share ✓')

  await waitForEventWhere(eventSets[2], 'trackSubscribed',
    data => data && data.some(d => d && d.source === SCREEN), env.TRACK_TIMEOUT)
  console.log('guest2 subscribed to screen share ✓')

  await pages[1].evaluate(async () => { await window.__room.localParticipant.setScreenShareEnabled(false) })
  console.log('guest1 stopped screen share')

  await waitForEventWhere(eventSets[0], 'trackUnsubscribed',
    data => data && data.some(d => d && d.source === SCREEN), env.TRACK_TIMEOUT)
  console.log('host saw screen share unsubscribed ✓')

  const camSubs = eventSets[0].filter(e =>
    e.ev === 'trackSubscribed' && e.data && e.data.some(d => d && d.source === 'camera'))
  expect(camSubs.length).toBeGreaterThan(0)
  console.log('host still has guest1 camera track ✓')

  for (const page of pages) await page.close()
})
