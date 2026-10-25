import { test, expect } from '@playwright/test'
import { connectParticipant, waitForEvent, roomName } from '../helpers.js'

test('4 participants all connect to LiveKit SFU', async ({ browser }) => {
  const room = roomName('connect-test')
  const names = ['host', 'guest1', 'guest2', 'guest3']
  const pages = [], eventSets = []

  for (const identity of names) {
    const page = await browser.newPage()
    pages.push(page)
    await page.goto('about:blank')
    const events = await connectParticipant(page, room, identity, identity)
    eventSets.push(events)
    await waitForEvent(events, 'connected', 20000)
    console.log(`${identity} connected ✓`)
  }

  for (let i = 0; i < names.length; i++)
    expect(eventSets[i].find(e => e.ev === 'connected')).toBeTruthy()

  for (const page of pages) await page.close()
})
