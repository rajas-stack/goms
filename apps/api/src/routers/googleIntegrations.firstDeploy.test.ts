import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'

/** The first production deploy of the linking code runs with AUTH_PROVIDER unset/`firebase` (Firebase stays the live provider). That is where the
 *  backfill must work, so it is tested in that exact mode, along with the guarantee that nothing sensitive is ever logged. */

const SUB = '1029384756'
const SAVED = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', docsId: 'docs-asha' }
const fb = (uid: string, email: string, sub: string | null = SUB) => ({
  authHeader: `Bearer ${fakeIdToken({ uid, email, ...(sub === null ? {} : { firebase: { identities: { 'google.com': [sub] }, sign_in_provider: 'google.com' } }) })}`,
})
const api = (ctx: { authHeader?: string }) => appRouter.createCaller(ctx).googleIntegrations
const rows = async () => (await pool.query('SELECT user_uid, email, settings, google_sub FROM google_integration_settings ORDER BY user_uid')).rows

beforeEach(async () => { await pool.query('DELETE FROM google_integration_settings') })
afterEach(() => { clearOauthEnv(); vi.restoreAllMocks() })

describe('AUTH_PROVIDER=firebase (Firebase remains the only provider)', () => {
  beforeEach(() => useOauthEnv('firebase'))

  it('stamps an existing row the first time its owner loads settings, and returns the settings unchanged', async () => {
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings) VALUES ('fb-asha','asha@amnex.com',$1)`, [SAVED])
    await expect(api(fb('fb-asha', 'asha@amnex.com')).get({ accountUid: 'fb-asha' })).resolves.toEqual(SAVED)
    expect(await rows()).toEqual([{ user_uid: 'fb-asha', email: 'asha@amnex.com', settings: SAVED, google_sub: SUB }])
  })

  it('is idempotent: loading twice stamps once and changes nothing else', async () => {
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings) VALUES ('fb-asha','asha@amnex.com',$1)`, [SAVED])
    await api(fb('fb-asha', 'asha@amnex.com')).get({ accountUid: 'fb-asha' })
    const after1 = await rows()
    await api(fb('fb-asha', 'asha@amnex.com')).get({ accountUid: 'fb-asha' })
    expect(await rows()).toEqual(after1)
  })

  it('saving for a brand-new user stores the sub; saving for an existing unstamped row stamps it', async () => {
    await api(fb('fb-new', 'new@amnex.com', '555')).save({ accountUid: 'fb-new', settings: SAVED })
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings) VALUES ('fb-old','old@amnex.com','{}')`)
    await api(fb('fb-old', 'old@amnex.com', '666')).save({ accountUid: 'fb-old', settings: SAVED })
    expect((await rows()).map((r) => [r.user_uid, r.google_sub])).toEqual([['fb-new', '555'], ['fb-old', '666']])
  })

  it('a different person on a reassigned address sees defaults and the old row is untouched (Firebase only)', async () => {
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings,google_sub) VALUES ('fb-asha','asha@amnex.com',$1,$2)`, [SAVED, SUB])
    const before = await rows()
    await expect(api(fb('fb-new-hire', 'asha@amnex.com', '999')).get({ accountUid: 'fb-new-hire' })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(await rows()).toEqual(before)
  })

  it('direct-OAuth (GOMS) tokens are still rejected in this mode: enabling the linking code does not enable OAuth', async () => {
    const ctx = await gomsContextForEmail('asha@amnex.com', `g:${SUB}`)
    await expect(api(ctx).get({ accountUid: `g:${SUB}` })).rejects.toMatchObject({ code: 'UNAUTHORIZED' })
  })
})

describe('nothing sensitive is logged', () => {
  beforeEach(() => useOauthEnv('both'))

  it('get/save/mismatch/rejection paths write no console output containing the email, the Google subject id, or a token', async () => {
    const spies = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}))
    await pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings,google_sub) VALUES ('fb-x','asha@amnex.com','{}','111')`)
    const asha = fb('fb-asha', 'asha@amnex.com', SUB)
    await api(asha).get({ accountUid: 'fb-asha' })
    await api(asha).save({ accountUid: 'fb-asha', settings: SAVED })
    await api(fb('fb-x', 'asha@amnex.com', SUB)).get({ accountUid: 'fb-x' }).catch(() => {}) // mismatch -> FORBIDDEN
    await api({ authHeader: 'Bearer garbage' }).get({ accountUid: 'x' }).catch(() => {})
    const output = spies.flatMap((s) => s.mock.calls).map((c) => c.map(String).join(' ')).join('\n')
    expect(output).not.toMatch(new RegExp(`asha@amnex|${SUB}|Bearer|fake\\.|eyJ`))
  })
})
