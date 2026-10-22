// apps/api/src/auth/oauth/firebaseTokenTelemetry.test.ts
// The one log event that says "a Firebase ID token was accepted" while the API runs in `both`. It is the evidence the OAuth-only switch
// is gated on, so what matters is (1) it fires for exactly the accepted-Firebase case, and (2) it can never carry a secret.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { buildApp } from '../../app.js'
import { fakeIdToken } from '../../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../../testHelpers/oauthTestHelpers.js'
import { verifyIdentity } from '../identity.js'

const EVENT = { event: 'auth.firebase_token_accepted' }
const UID = 'fb-secret-uid-123', EMAIL = 'private.person@amnex.com'
const firebaseToken = () => fakeIdToken({ uid: UID, email: EMAIL })
const firebase = () => `Bearer ${firebaseToken()}`

let info: ReturnType<typeof vi.spyOn>
let warn: ReturnType<typeof vi.spyOn>
let error: ReturnType<typeof vi.spyOn>
let log: ReturnType<typeof vi.spyOn>
beforeEach(() => {
  info = vi.spyOn(console, 'info').mockImplementation(() => {}); warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
  error = vi.spyOn(console, 'error').mockImplementation(() => {}); log = vi.spyOn(console, 'log').mockImplementation(() => {})
})
afterEach(() => { for (const s of [info, warn, error, log]) s.mockRestore(); clearOauthEnv() })

/** Every line anything wrote to the console, as one string. */
const everythingLogged = () => [info, warn, error, log].flatMap(s => s.mock.calls.map((call: unknown[]) => call.map(String).join(' '))).join('\n')
const acceptedEvents = () => [info, log].flatMap(s => s.mock.calls).map(call => String(call[0])).filter(line => line.includes('auth.firebase_token_accepted'))

describe('auth.firebase_token_accepted', () => {
  it('is written once, with nothing but the event name, when `both` accepts a Firebase token', async () => {
    useOauthEnv('both')
    await expect(verifyIdentity(firebase())).resolves.toEqual({ uid: UID, email: EMAIL })
    expect(acceptedEvents()).toHaveLength(1)
    expect(JSON.parse(acceptedEvents()[0])).toEqual(EVENT)
  })
  it('never carries the token, the uid, the email, a bearer header or any JWT-shaped text', async () => {
    useOauthEnv('both')
    await verifyIdentity(firebase())
    const text = everythingLogged()
    for (const secret of [firebaseToken(), firebaseToken().split('.')[1], UID, EMAIL, 'private.person', 'Bearer', 'eyJ', 'authorization', 'cookie', 'code=', 'state=']) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase())
    }
  })
  it('is NOT written for a GOMS token in `both`', async () => {
    useOauthEnv('both')
    await verifyIdentity((await gomsContextForEmail('someone@amnex.com', 'g:1')).authHeader)
    expect(acceptedEvents()).toHaveLength(0)
  })
  it('is NOT written in `firebase` mode (every request is Firebase there, so production logs do not change until `both`)', async () => {
    useOauthEnv('firebase')
    await expect(verifyIdentity(firebase())).resolves.toMatchObject({ uid: UID })
    expect(acceptedEvents()).toHaveLength(0)
  })
  it('is NOT written when `oauth` mode rejects a Firebase token', async () => {
    useOauthEnv('oauth')
    await expect(verifyIdentity(firebase())).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(acceptedEvents()).toHaveLength(0)
  })
  it.each([['a garbage token', 'Bearer not-a-real-token'], ['no header', undefined], ['an unverified email', `Bearer ${fakeIdToken({ uid: UID, email: EMAIL, email_verified: false })}`]] as const)(
    'is NOT written for %s in `both` (only an accepted token counts)', async (_label, header) => {
      useOauthEnv('both')
      await expect(verifyIdentity(header)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(acceptedEvents()).toHaveLength(0)
    })

  it('fires from a real request through the app (a protected tRPC call with a Firebase bearer) and still never leaks the credential', async () => {
    useOauthEnv('both')
    const app = await buildApp({ rateLimit: { max: 10_000, timeWindow: '1 minute' } })
    try {
      const res = await app.inject({ method: 'GET', url: '/api/trpc/googleIntegrations.get?input=' + encodeURIComponent(JSON.stringify({ accountUid: UID })), headers: { authorization: firebase(), cookie: '__session=abc.def', origin: 'https://goms.test' } })
      expect(res.statusCode).toBe(200)
      expect(acceptedEvents().length).toBeGreaterThanOrEqual(1)
      for (const line of acceptedEvents()) expect(JSON.parse(line)).toEqual(EVENT)
      const text = everythingLogged()
      for (const secret of [firebaseToken(), UID, EMAIL, '__session', 'abc.def']) expect(text).not.toContain(secret)
    } finally { await app.close() }
  })
})
