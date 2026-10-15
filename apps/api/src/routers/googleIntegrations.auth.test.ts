import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'
import { signAccessToken } from '../auth/oauth/accessToken.js'
import type { AuthProvider } from '../auth/oauth/config.js'

/** Per-user Google integration settings across the Firebase -> direct Google OAuth transition. The router must authenticate through the shared
 *  `verifyIdentity` seam (never Firebase directly), so it accepts exactly the tokens every other procedure accepts for the same AUTH_PROVIDER,
 *  and a user who signs in through the other provider still finds the settings they saved before. Real database; no mocks of identity. */

const EMAIL = 'asha@amnex.com'
const FIREBASE_UID = 'fb-uid-asha'
const OAUTH_UID = 'g:1029384756'
const SAVED = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', docsId: 'docs-1' }
const OTHER = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '999.apps.googleusercontent.com', sheetsId: 'sheet-9' }

const firebaseCtx = (email = EMAIL, uid = FIREBASE_UID, verified = true) => ({ authHeader: `Bearer ${fakeIdToken({ uid, email, email_verified: verified })}` })
const gomsCtx = (email = EMAIL, uid = OAUTH_UID) => gomsContextForEmail(email, uid)
const api = (ctx: { authHeader?: string }) => appRouter.createCaller(ctx).googleIntegrations

async function seed(uid: string, email: string, settings: object, updatedAt?: string) {
  await pool.query(
    `INSERT INTO google_integration_settings (user_uid, email, settings, updated_at) VALUES ($1,$2,$3, COALESCE($4::timestamptz, now()))`,
    [uid, email, settings, updatedAt ?? null],
  )
}
const rows = async () => (await pool.query('SELECT user_uid, email, settings FROM google_integration_settings ORDER BY user_uid')).rows

beforeEach(async () => { await pool.query('DELETE FROM google_integration_settings') })
afterEach(() => { clearOauthEnv(); delete process.env.AUTH_ENFORCEMENT_ENABLED; delete process.env.READ_AUTH_ENFORCEMENT_ENABLED; vi.restoreAllMocks() })

describe.each([
  ['firebase', true, false], ['both', true, true], ['oauth', false, true],
] as const satisfies readonly (readonly [AuthProvider, boolean, boolean])[])('AUTH_PROVIDER=%s', (provider, acceptsFirebase, acceptsGoms) => {
  beforeEach(() => useOauthEnv(provider))

  it(`${acceptsFirebase ? 'serves' : 'rejects'} a Firebase-signed-in user`, async () => {
    await seed(FIREBASE_UID, EMAIL, SAVED)
    const call = api(firebaseCtx()).get({ accountUid: FIREBASE_UID })
    if (acceptsFirebase) await expect(call).resolves.toEqual(SAVED)
    else await expect(call).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })

  it(`${acceptsGoms ? 'serves' : 'rejects'} a GOMS (direct Google OAuth) user, for both get and save`, async () => {
    const ctx = await gomsCtx()
    const get = api(ctx).get({ accountUid: OAUTH_UID })
    const save = () => api(ctx).save({ accountUid: OAUTH_UID, settings: SAVED })
    if (acceptsGoms) {
      await expect(get).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
      await expect(save()).resolves.toEqual(SAVED)
      expect((await rows()).map((r) => r.user_uid)).toEqual([OAUTH_UID])
    } else {
      await expect(get).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      await expect(save()).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
      expect(await rows()).toEqual([])
    }
  })
})

describe('rejected tokens never reach the database', () => {
  beforeEach(() => useOauthEnv('both'))
  const cases: [string, () => Promise<{ authHeader?: string }>][] = [
    ['no Authorization header', async () => ({})],
    ['a non-Bearer scheme', async () => ({ authHeader: 'Basic abc' })],
    ['a garbage token', async () => ({ authHeader: 'Bearer not-a-token' })],
    ['an unverified Firebase email', async () => firebaseCtx(EMAIL, FIREBASE_UID, false)],
    ['an expired GOMS token', async () => {
      const { token } = await signAccessToken({ uid: OAUTH_UID, email: EMAIL, familyId: '33333333-3333-3333-3333-333333333333' }, new Date(Date.now() - 3600_000))
      return { authHeader: `Bearer ${token}` }
    }],
    ['a GOMS token signed with another key', async () => {
      process.env.AUTH_SESSION_SECRET = 'q'.repeat(40)
      const { token } = await signAccessToken({ uid: OAUTH_UID, email: EMAIL, familyId: '33333333-3333-3333-3333-333333333333' })
      useOauthEnv('both')
      return { authHeader: `Bearer ${token}` }
    }],
  ]
  it.each(cases)('%s -> UNAUTHORIZED, no query', async (_name, make) => {
    const ctx = await make()
    const spy = vi.spyOn(pool, 'query')
    await expect(api(ctx).get({ accountUid: OAUTH_UID })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    await expect(api(ctx).save({ accountUid: OAUTH_UID, settings: SAVED })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('authorization', () => {
  beforeEach(() => useOauthEnv('both'))

  it('a non-Amnex identity is FORBIDDEN (defence in depth: the API only issues GOMS tokens to Amnex accounts)', async () => {
    const spy = vi.spyOn(pool, 'query')
    await expect(api(await gomsCtx('someone@gmail.com', 'g:7')).get({ accountUid: 'g:7' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(firebaseCtx('someone@gmail.com', 'fb-7')).get({ accountUid: 'fb-7' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect(spy).not.toHaveBeenCalled()
  })

  it('a caller can only touch their own uid, whichever provider they used (no reading or writing as someone else)', async () => {
    await seed('g:other', 'other@amnex.com', OTHER)
    await expect(api(await gomsCtx()).get({ accountUid: 'g:other' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(await gomsCtx()).save({ accountUid: 'g:other', settings: SAVED })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(firebaseCtx()).get({ accountUid: OAUTH_UID })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await rows()).map((r) => r.settings)).toEqual([OTHER])
  })

  it('keeps working with both enforcement flags on (the same identity seam is shared by protectedProcedure and protectedReadProcedure)', async () => {
    process.env.AUTH_ENFORCEMENT_ENABLED = 'true'
    process.env.READ_AUTH_ENFORCEMENT_ENABLED = 'true'
    await expect(api(await gomsCtx()).save({ accountUid: OAUTH_UID, settings: SAVED })).resolves.toEqual(SAVED)
    await expect(api(await gomsCtx()).get({ accountUid: OAUTH_UID })).resolves.toEqual(SAVED)
    await expect(api(firebaseCtx()).get({ accountUid: FIREBASE_UID })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS) // a different identity (Firebase uid): its own, empty, settings
    await expect(api({}).get({ accountUid: OAUTH_UID })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('settings belong to one identity: there is NO automatic email-based fallback', () => {
  beforeEach(() => useOauthEnv('both'))

  it('an OAuth sign-in never sees settings saved under a Firebase uid, even for the same email (and nothing is written)', async () => {
    await seed(FIREBASE_UID, EMAIL, SAVED)
    const before = await rows()
    await expect(api(await gomsCtx()).get({ accountUid: OAUTH_UID })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(await rows()).toEqual(before)
  })

  it('and the reverse: a Firebase sign-in never sees settings saved under a g:<sub> uid', async () => {
    await seed(OAUTH_UID, EMAIL, SAVED)
    await expect(api(firebaseCtx()).get({ accountUid: FIREBASE_UID })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
  })

  it('a reassigned address does not inherit the previous holder\'s settings (different uid, same email)', async () => {
    await seed('fb-previous-holder', EMAIL, SAVED)
    await expect(api(await gomsCtx(EMAIL, 'g:new-person')).get({ accountUid: 'g:new-person' })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    await expect(api(firebaseCtx(EMAIL, 'fb-new-person')).get({ accountUid: 'fb-new-person' })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
  })

  it('saving under one identity creates only that identity\'s row and never edits another identity\'s row for the same email', async () => {
    await seed(FIREBASE_UID, EMAIL, SAVED)
    await api(await gomsCtx()).save({ accountUid: OAUTH_UID, settings: OTHER })
    expect((await rows()).map((r) => [r.user_uid, r.settings])).toEqual([[FIREBASE_UID, SAVED], [OAUTH_UID, OTHER]])
    await expect(api(firebaseCtx()).get({ accountUid: FIREBASE_UID })).resolves.toEqual(SAVED)
    await expect(api(await gomsCtx()).get({ accountUid: OAUTH_UID })).resolves.toEqual(OTHER)
  })

  it('each identity reads only its own row when several rows share an email', async () => {
    await seed(FIREBASE_UID, EMAIL, SAVED)
    await seed(OAUTH_UID, EMAIL, OTHER)
    await expect(api(await gomsCtx()).get({ accountUid: OAUTH_UID })).resolves.toEqual(OTHER)
    await expect(api(firebaseCtx()).get({ accountUid: FIREBASE_UID })).resolves.toEqual(SAVED)
  })
})
