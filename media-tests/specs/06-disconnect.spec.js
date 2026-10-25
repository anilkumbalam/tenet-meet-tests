import { test, expect } from '@playwright/test'
import { connectParticipant, waitForEvent, roomName } from '../helpers.js'
import env from '../env.js'

test('participant disconnect is seen by others', async ({ browser }) => {
  const room = roomName('disconnect-test')
  const names = ['host', 'guest1', 'guest2', 'guest3']
  const pages = [], eventSets = []

  for (const identity of names) {
    const page = await browser.newPage()
    pages.push(page)
    await page.goto('about:blank')
    const events = await connectParticipant(page, room, identity, identity)
    eventSets.push(events)
  }

  await new Promise(r => setTimeout(r, 4000))

  await pages[3].evaluate(async () => { await window.__room.disconnect() })
  await pages[3].close()
  console.log('guest3 disconnected')

  await waitForEvent(eventSets[0], 'participantDisconnected', env.EVENT_TIMEOUT)
  console.log('host saw participantDisconnected ✓')
  await waitForEvent(eventSets[1], 'participantDisconnected', env.EVENT_TIMEOUT)
  console.log('guest1 saw participantDisconnected ✓')
  await waitForEvent(eventSets[2], 'participantDisconnected', env.EVENT_TIMEOUT)
  console.log('guest2 saw participantDisconnected ✓')

  for (let i = 0; i < 3; i++) await pages[i].close()
})
