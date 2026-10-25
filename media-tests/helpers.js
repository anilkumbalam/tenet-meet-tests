import env from './env.js'

export async function mintToken(roomName, identity, name = identity, extraGrants = {}) {
  const { AccessToken } = await import('/opt/tenet-meet-tests/node_modules/livekit-server-sdk/dist/index.js')
  const at = new AccessToken(env.LIVEKIT_API_KEY, env.LIVEKIT_API_SECRET, {
    identity, name, ttl: '1h',
  })
  at.addGrant({ roomJoin: true, room: roomName, canPublish: true, canSubscribe: true, canPublishData: true, ...extraGrants })
  return at.toJwt()
}

export function roomName(prefix = 'media-test') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
}

export async function connectParticipant(page, roomNameStr, identity, name) {
  const token = await mintToken(roomNameStr, identity, name)

  // Navigate to the SDK script URL itself — it's a JS file so no redirect,
  // and it establishes the https origin so navigator.mediaDevices is available.
  // Then replace the page content with a blank document.
  await page.goto(`${env.MEET_URL}/tenet-media-client.min.js`, { waitUntil: 'commit', timeout: 15000 })
  await page.evaluate(() => {
    document.open()
    document.write('<html><body></body></html>')
    document.close()
  })
  await page.addScriptTag({ url: `${env.MEET_URL}/tenet-media-client.min.js` })

  const events = []
  await page.exposeFunction('__lkPush', (ev, data) => events.push({ ev, data, t: Date.now() }))
  await page.evaluate(async ({ url, token }) => {
    window.__room = new LivekitClient.Room({ adaptiveStream: false, dynacast: false })
    const R = LivekitClient.RoomEvent
    const fwd = (name) => window.__room.on(name, (...a) => {
      const safe = a.map(x => {
        if (!x || typeof x !== 'object') return x
        if (x.identity !== undefined) return { identity: x.identity, name: x.name }
        if (x.sid !== undefined) return { sid: x.sid, kind: x.kind, source: x.source }
        if (x.trackSid !== undefined) return { trackSid: x.trackSid, source: x.source, kind: x.kind }
        return {}
      })
      window.__lkPush(name, safe)
    })
    ;[R.Connected, R.Disconnected, R.TrackSubscribed, R.TrackUnsubscribed,
      R.TrackMuted, R.TrackUnmuted, R.LocalTrackPublished, R.LocalTrackUnpublished,
      R.ParticipantConnected, R.ParticipantDisconnected].forEach(fwd)
    await window.__room.connect(url, token)
    await window.__room.localParticipant.enableCameraAndMicrophone()
  }, { url: env.LIVEKIT_URL, token })
  return events
}

export async function waitForEvent(events, evName, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = events.find(e => e.ev === evName)
    if (found) return found
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Timeout waiting for event: ${evName}`)
}

export async function waitForEventWhere(events, evName, pred, timeout = 15000) {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const found = events.find(e => e.ev === evName && pred(e.data))
    if (found) return found
    await new Promise(r => setTimeout(r, 200))
  }
  throw new Error(`Timeout waiting for event: ${evName} with condition`)
}
