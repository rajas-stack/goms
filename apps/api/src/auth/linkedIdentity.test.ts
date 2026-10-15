import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'
import { verifyIdentity, verifyLinkedIdentity } from './identity.js'

/** The Google subject id is stated ONLY by a verified token: Firebase's own `firebase.identities['google.com']` claim, or the `g:<sub>` uid of a
 *  GOMS token. `verifyIdentity` (used everywhere else) keeps returning exactly `{ uid, email }`. */
afterEach(() => clearOauthEnv())
const fbHeader = (o: Parameters<typeof fakeIdToken>[0]) => `Bearer ${fakeIdToken(o)}`

describe.each(['firebase', 'both'] as const)('Firebase token, AUTH_PROVIDER=%s', (provider) => {
  beforeEach(() => useOauthEnv(provider))
  it('exposes the Google subject id the token proves', async () => {
    const h = fbHeader({ uid: 'fb-1', email: 'a@amnex.com', firebase: { identities: { 'google.com': ['1029384756'] }, sign_in_provider: 'google.com' } })
    await expect(verifyLinkedIdentity(h)).resolves.toEqual({ uid: 'fb-1', email: 'a@amnex.com', googleSub: '1029384756' })
  })
  it.each([
    ['no firebase claim', {}],
    ['no google.com identity', { firebase: { identities: { email: ['a@amnex.com'] }, sign_in_provider: 'password' } }],
    ['an empty identity list', { firebase: { identities: { 'google.com': [] as string[] } } }],
    ['an empty id', { firebase: { identities: { 'google.com': [''] } } }],
  ])('proves no subject id when the token has %s', async (_n, extra) => {
    const r = await verifyLinkedIdentity(fbHeader({ uid: 'fb-1', email: 'a@amnex.com', ...extra }))
    expect(r.googleSub).toBeUndefined()
  })
  it('verifyIdentity is unchanged: just { uid, email }', async () => {
    const h = fbHeader({ uid: 'fb-1', email: 'a@amnex.com', firebase: { identities: { 'google.com': ['1029384756'] } } })
    await expect(verifyIdentity(h)).resolves.toStrictEqual({ uid: 'fb-1', email: 'a@amnex.com' })
  })
})

describe.each(['both', 'oauth'] as const)('GOMS token, AUTH_PROVIDER=%s', (provider) => {
  beforeEach(() => useOauthEnv(provider))
  it('exposes the subject id from the g:<sub> uid', async () => {
    const { authHeader } = await gomsContextForEmail('a@amnex.com', 'g:1029384756')
    await expect(verifyLinkedIdentity(authHeader)).resolves.toEqual({ uid: 'g:1029384756', email: 'a@amnex.com', googleSub: '1029384756' })
  })
  it.each(['weird-uid', 'g:', 'x:1029384756'])('proves no subject id for the uid %j', async (uid) => {
    const { authHeader } = await gomsContextForEmail('a@amnex.com', uid)
    expect((await verifyLinkedIdentity(authHeader)).googleSub).toBeUndefined()
  })
  it('verifyIdentity is unchanged: just { uid, email }', async () => {
    const { authHeader } = await gomsContextForEmail('a@amnex.com', 'g:1029384756')
    await expect(verifyIdentity(authHeader)).resolves.toStrictEqual({ uid: 'g:1029384756', email: 'a@amnex.com' })
  })
})

describe('rejected tokens still reject, with the same errors', () => {
  beforeEach(() => useOauthEnv('both'))
  it.each([undefined, 'Bearer not-a-token', 'Basic abc'])('%s', async (h) => {
    await expect(verifyLinkedIdentity(h)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(verifyIdentity(h)).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
  it('an unverified Firebase email is refused', async () => {
    await expect(verifyLinkedIdentity(fbHeader({ uid: 'x', email: 'a@amnex.com', email_verified: false }))).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})
