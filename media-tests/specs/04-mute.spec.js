import { test, expect } from '@playwright/test'
import { connectParticipant, waitForEvent, roomName } from '../helpers.js'
import env from '../env.js'

test('mic mute/unmute events propagate between participants', async ({ browser }) => {
  const room = roomName('mute-test')
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

  await pages[0].evaluate(async () => { await window.__room.localParticipant.setMicrophoneEnabled(false) })
  console.log('host muted mic')
  await waitForEvent(eventSets[1], 'trackMuted', env.EVENT_TIMEOUT)
  console.log('guest1 saw trackMuted ✓')
  await waitForEvent(eventSets[2], 'trackMuted', env.EVENT_TIMEOUT)
  console.log('guest2 saw trackMuted ✓')

  await pages[0].evaluate(async () => { await window.__room.localParticipant.setMicrophoneEnabled(true) })
  console.log('host unmuted mic')
  await waitForEvent(eventSets[1], 'trackUnmuted', env.EVENT_TIMEOUT)
  console.log('guest1 saw trackUnmuted ✓')

  await pages[1].evaluate(async () => { await window.__room.localParticipant.setMicrophoneEnabled(false) })
  console.log('guest1 muted mic')
  await waitForEvent(eventSets[0], 'trackMuted', env.EVENT_TIMEOUT)
  console.log('host saw guest1 trackMuted ✓')

  for (const page of pages) await page.close()
})
