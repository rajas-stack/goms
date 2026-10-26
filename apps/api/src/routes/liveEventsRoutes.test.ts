import { afterEach, describe, expect, it } from 'vitest'
import { buildApp } from '../app.js'
import { MAX_STREAMS, subscribe, wakeStreams } from '../live/changeFeed.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'

afterEach(() => { delete process.env.AUTH_ENFORCEMENT_ENABLED })

describe('GET /api/events', () => {
  it('requires a signed-in identity whenever the API enforces auth', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const app = await buildApp()
    expect((await app.inject({ method: 'GET', url: '/api/events' })).statusCode).toBe(401)
    const outsider = await app.inject({ method: 'GET', url: '/api/events', headers: { authorization: `Bearer ${fakeIdToken({ email: 'someone@gmail.com' })}` } })
    expect(outsider.statusCode).toBe(403)
    await app.close()
  })

  it('streams one change event to a signed-in user and then ends', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    const app = await buildApp()
    const response = app.inject({ method: 'GET', url: '/api/events', headers: { authorization: `Bearer ${fakeIdToken()}` } })
    wakeStreams() // as a NOTIFY from any API process would
    const res = await response
    expect(res.statusCode).toBe(200)
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/)
    expect(res.headers['x-accel-buffering']).toBe('no')
    expect(res.payload).toBe(': connected\n\ndata: change\n\n')
    await app.close()
  })

  it('answers 503 once this process holds the maximum number of streams', async () => {
    const app = await buildApp()
    const held = Array.from({ length: MAX_STREAMS }, () => subscribe(() => {}))
    try {
      const res = await app.inject({ method: 'GET', url: '/api/events' })
      expect(res.statusCode).toBe(503)
      expect(res.headers['retry-after']).toBe('30')
    } finally {
      for (const release of held) release?.()
      await app.close()
    }
  })
})
