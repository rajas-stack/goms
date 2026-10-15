import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'

/** Link saved settings to the person's Google subject id (`sub`), which Google never reassigns, instead of to a mutable email.
 *  Both providers can state the sub from a VERIFIED token: Firebase carries it in `firebase.identities['google.com']`, a GOMS token as `g:<sub>`.
 *  Rows are found by sub, else by the caller's own uid; an email is only ever stored (kept current), never used to look anything up. */

const SUB_ASHA = '1029384756'
const SUB_OTHER = '5550001111'
const ASHA = { sub: SUB_ASHA, fbUid: 'fb-asha', gUid: `g:${SUB_ASHA}`, email: 'asha@amnex.com' }
const SAVED = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', docsId: 'docs-asha' }
const EDITED = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', docsId: 'docs-asha-v2' }
const THEIRS = { ...DEFAULT_GOOGLE_INTEGRATIONS, sheetsId: 'sheet-of-someone-else' }

/** A Firebase sign-in. `sub: null` = a token that carries no Google identity at all. */
const firebase = (o: { uid: string; email: string; sub?: string | null }) => ({
  authHeader: `Bearer ${fakeIdToken({
    uid: o.uid, email: o.email,
    ...(o.sub === null ? {} : { firebase: { identities: { 'google.com': [o.sub ?? ASHA.sub] }, sign_in_provider: 'google.com' } }),
  })}`,
})
const oauth = (email: string, sub: string) => gomsContextForEmail(email, `g:${sub}`)
const api = (ctx: { authHeader?: string }) => appRouter.createCaller(ctx).googleIntegrations
const seed = (uid: string, email: string, settings: object, sub: string | null = null, at?: string) =>
  pool.query(
    'INSERT INTO google_integration_settings (user_uid,email,settings,google_sub,updated_at) VALUES ($1,$2,$3,$4, COALESCE($5::timestamptz, now()))',
    [uid, email, settings, sub, at ?? null],
  )
const rows = async () => (await pool.query('SELECT user_uid, email, settings, google_sub FROM google_integration_settings ORDER BY user_uid')).rows

beforeEach(async () => { await pool.query('DELETE FROM google_integration_settings'); useOauthEnv('both') })
afterEach(() => { clearOauthEnv(); vi.restoreAllMocks() })

describe('one person, two providers: a single canonical row, found by Google sub', () => {
  it('backfill: a Firebase sign-in stamps the sub onto its own pre-existing row (and returns it)', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED)
    await expect(api(firebase({ uid: ASHA.fbUid, email: ASHA.email })).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect((await rows())[0]).toMatchObject({ user_uid: ASHA.fbUid, google_sub: ASHA.sub })
  })

  it('after the flip, the OAuth identity (g:<sub>) finds the Firebase-era row, edits it in place, and creates no second row', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    await expect(api(await oauth(ASHA.email, ASHA.sub)).get({ accountUid: ASHA.gUid })).resolves.toEqual(SAVED)
    await api(await oauth(ASHA.email, ASHA.sub)).save({ accountUid: ASHA.gUid, settings: EDITED })
    expect(await rows()).toEqual([{ user_uid: ASHA.fbUid, email: ASHA.email, settings: EDITED, google_sub: ASHA.sub }])
  })

  it('rollback: the Firebase identity sees the edits made under OAuth, and the row keeps the ORIGINAL uid (old code reading by user_uid still works)', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    await api(await oauth(ASHA.email, ASHA.sub)).save({ accountUid: ASHA.gUid, settings: EDITED })
    await expect(api(firebase({ uid: ASHA.fbUid, email: ASHA.email })).get({ accountUid: ASHA.fbUid })).resolves.toEqual(EDITED)
    const legacy = await pool.query('SELECT settings FROM google_integration_settings WHERE user_uid=$1', [ASHA.fbUid]) // the pre-link code's exact query
    expect(legacy.rows[0].settings).toEqual(EDITED)
  })

  it('a new OAuth-only person gets their own row keyed g:<sub> with the sub stamped', async () => {
    await api(await oauth('ravi@amnex.com', SUB_OTHER)).save({ accountUid: `g:${SUB_OTHER}`, settings: SAVED })
    expect(await rows()).toMatchObject([{ user_uid: `g:${SUB_OTHER}`, email: 'ravi@amnex.com', google_sub: SUB_OTHER }])
  })

  it('first saves from both providers at the same moment still produce exactly one row and no error', async () => {
    const results = await Promise.allSettled([
      api(firebase({ uid: ASHA.fbUid, email: ASHA.email })).save({ accountUid: ASHA.fbUid, settings: SAVED }),
      (async () => api(await oauth(ASHA.email, ASHA.sub)).save({ accountUid: ASHA.gUid, settings: EDITED }))(),
    ])
    expect(results.map((r) => r.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await rows()).toHaveLength(1)
  })
})

describe('changed email addresses', () => {
  it('a renamed mailbox keeps its settings (the sub is unchanged) and the stored email is brought up to date on save', async () => {
    await seed(ASHA.fbUid, 'asha.old@amnex.com', SAVED, ASHA.sub)
    const renamed = await oauth('asha.new@amnex.com', ASHA.sub)
    await expect(api(renamed).get({ accountUid: ASHA.gUid })).resolves.toEqual(SAVED)
    await api(renamed).save({ accountUid: ASHA.gUid, settings: EDITED })
    expect(await rows()).toMatchObject([{ user_uid: ASHA.fbUid, email: 'asha.new@amnex.com', settings: EDITED }])
  })
})

describe('reassigned email addresses never inherit', () => {
  it('a new person (new sub) on the previous holder\'s address sees defaults, in either provider, and the old row is untouched', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    const before = await rows()
    await expect(api(await oauth(ASHA.email, SUB_OTHER)).get({ accountUid: `g:${SUB_OTHER}` })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    await expect(api(firebase({ uid: 'fb-new', email: ASHA.email, sub: SUB_OTHER })).get({ accountUid: 'fb-new' })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(await rows()).toEqual(before)
  })

  it('their first save creates a separate row and leaves the previous holder\'s row exactly as it was', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    await api(await oauth(ASHA.email, SUB_OTHER)).save({ accountUid: `g:${SUB_OTHER}`, settings: THEIRS })
    expect(await rows()).toMatchObject([
      { user_uid: ASHA.fbUid, settings: SAVED, google_sub: ASHA.sub },
      { user_uid: `g:${SUB_OTHER}`, settings: THEIRS, google_sub: SUB_OTHER },
    ])
  })

  it('a legacy row that was never stamped (no sub) is NEVER matched by email, so a reassigned address cannot pick it up', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, null)
    await expect(api(await oauth(ASHA.email, ASHA.sub)).get({ accountUid: ASHA.gUid })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    await expect(api(await oauth(ASHA.email, SUB_OTHER)).get({ accountUid: `g:${SUB_OTHER}` })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect((await rows())[0]).toMatchObject({ user_uid: ASHA.fbUid, google_sub: null })
  })
})

describe('mismatched identities fail closed', () => {
  it('a row owned by one uid but stamped with a DIFFERENT sub than the token proves is refused (no read, no write)', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, SUB_OTHER)
    const ctx = firebase({ uid: ASHA.fbUid, email: ASHA.email, sub: ASHA.sub })
    await expect(api(ctx).get({ accountUid: ASHA.fbUid })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(ctx).save({ accountUid: ASHA.fbUid, settings: EDITED })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await rows())[0]).toMatchObject({ settings: SAVED, google_sub: SUB_OTHER })
  })

  it('a Firebase token with no Google identity never links: it behaves exactly as today, by its own uid only, and is not stamped', async () => {
    await seed('fb-pw', 'pw@amnex.com', SAVED, null)
    await seed('fb-other', 'x@amnex.com', THEIRS, SUB_OTHER)
    const ctx = firebase({ uid: 'fb-pw', email: 'pw@amnex.com', sub: null })
    await expect(api(ctx).get({ accountUid: 'fb-pw' })).resolves.toEqual(SAVED)
    expect((await rows()).find((r) => r.user_uid === 'fb-pw')?.google_sub).toBeNull()
  })

  it('a GOMS uid that is not g:<sub> proves no sub and links nothing', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    const ctx = await gomsContextForEmail(ASHA.email, 'weird-uid')
    await expect(api(ctx).get({ accountUid: 'weird-uid' })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
  })

  it('accountUid must still equal the verified uid (the existing check is unchanged)', async () => {
    await seed(ASHA.fbUid, ASHA.email, SAVED, ASHA.sub)
    await expect(api(await oauth(ASHA.email, ASHA.sub)).get({ accountUid: ASHA.fbUid })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })
})

describe('cross-user access', () => {
  it('nobody can read or overwrite another person\'s row, whichever provider each uses', async () => {
    await seed('fb-bob', 'bob@amnex.com', THEIRS, SUB_OTHER)
    const asha = await oauth(ASHA.email, ASHA.sub)
    await expect(api(asha).get({ accountUid: 'fb-bob' })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(asha).save({ accountUid: 'fb-bob', settings: SAVED })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    await expect(api(asha).get({ accountUid: ASHA.gUid })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    await api(asha).save({ accountUid: ASHA.gUid, settings: SAVED })
    expect((await rows()).find((r) => r.user_uid === 'fb-bob')).toMatchObject({ settings: THEIRS, google_sub: SUB_OTHER, email: 'bob@amnex.com' })
  })

  it('the sub is taken only from the verified token, never from client input (extra input fields are rejected)', async () => {
    await expect(api(await oauth(ASHA.email, ASHA.sub)).get({ accountUid: ASHA.gUid, googleSub: SUB_OTHER } as never)).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('a stamp can never take a sub that already belongs to another row: the stamped (canonical) row wins', async () => {
    await seed('fb-a', 'a@amnex.com', SAVED, ASHA.sub)
    await seed('fb-a-dup', 'a-dup@amnex.com', THEIRS, null) // an unstamped duplicate for the same person
    const ctx = firebase({ uid: 'fb-a-dup', email: 'a-dup@amnex.com', sub: ASHA.sub })
    await expect(api(ctx).get({ accountUid: 'fb-a-dup' })).resolves.toEqual(SAVED)
    expect((await rows()).filter((r) => r.google_sub === ASHA.sub)).toHaveLength(1)
  })
})
