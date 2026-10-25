import { test, expect } from '@playwright/test'
import { connectParticipant, roomName } from '../helpers.js'

test('4 participants publish and subscribe camera+audio tracks', async ({ browser }) => {
  const room = roomName('tracks-test')
  const names = ['host', 'guest1', 'guest2', 'guest3']
  const pages = [], eventSets = []

  for (const identity of names) {
    const page = await browser.newPage()
    pages.push(page)
    await page.goto('about:blank')
    const events = await connectParticipant(page, room, identity, identity)
    eventSets.push(events)
  }

  for (let i = 0; i < names.length; i++) {
    const events = eventSets[i]
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (events.filter(e => e.ev === 'trackSubscribed').length >= 6) break
      await new Promise(r => setTimeout(r, 500))
    }
    const subs = events.filter(e => e.ev === 'trackSubscribed')
    console.log(`${names[i]}: ${subs.length} tracks subscribed`)
    expect(subs.length).toBeGreaterThanOrEqual(6)
  }

  for (const page of pages) await page.close()
})
