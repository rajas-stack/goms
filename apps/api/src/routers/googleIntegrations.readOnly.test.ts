import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { appRouter } from '../index.js'
import { pool } from '../db.js'
import { fakeIdToken } from '../testHelpers/authTestHelpers.js'
import { clearOauthEnv, gomsContextForEmail, useOauthEnv } from '../testHelpers/oauthTestHelpers.js'

/** EMERGENCY_READ_ONLY is the incident kill switch: no data may change. `googleIntegrations.get` is a query that used to write (it stamps the person's
 *  Google sub onto their row); in read-only mode it must not stamp, take row locks or issue any other write. And outside read-only mode the stamp is
 *  best effort: it can never turn a read that succeeded into an error. */

const SUB = '1029384756'
const ASHA = { sub: SUB, fbUid: 'fb-asha', gUid: `g:${SUB}`, email: 'asha@amnex.com' }
const SAVED = { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', docsId: 'docs-asha' }
const firebase = (uid: string, email: string, sub = SUB) => ({
  authHeader: `Bearer ${fakeIdToken({ uid, email, firebase: { identities: { 'google.com': [sub] }, sign_in_provider: 'google.com' } })}`,
})
const api = (ctx: { authHeader?: string }) => appRouter.createCaller(ctx).googleIntegrations
const seed = (uid: string, settings: object, sub: string | null = null) =>
  pool.query(`INSERT INTO google_integration_settings (user_uid,email,settings,google_sub,updated_at) VALUES ($1,$2,$3,$4,'2026-01-02T03:04:05Z')`, [uid, ASHA.email, settings, sub])
const rows = async () => (await pool.query('SELECT user_uid, settings, google_sub, updated_at FROM google_integration_settings ORDER BY user_uid')).rows

const WAS = process.env.EMERGENCY_READ_ONLY
beforeEach(async () => { await pool.query('DELETE FROM google_integration_settings'); useOauthEnv('both') })
afterEach(async () => {
  if (WAS === undefined) delete process.env.EMERGENCY_READ_ONLY; else process.env.EMERGENCY_READ_ONLY = WAS
  clearOauthEnv(); vi.restoreAllMocks()
  await pool.query('DROP TRIGGER IF EXISTS test_refuse_stamp ON google_integration_settings')
  await pool.query('DROP FUNCTION IF EXISTS test_refuse_stamp()')
})

/** Every SQL text sent through the pool, directly or through a client checked out with `pool.connect()`, plus how many such checkouts happened.
 *  pg's own `pool.query` calls `this.connect(callback)` internally, so only the promise form (no arguments: what inTransaction uses) is intercepted. */
function watchPool(opts: { failCheckout?: boolean } = {}): { sql: string[]; checkouts: () => number } {
  const sql: string[] = []
  let checkouts = 0
  const text = (a: unknown) => (typeof a === 'string' ? a : (a as { text?: string })?.text ?? '')
  const q = pool.query.bind(pool) as (...a: unknown[]) => unknown
  vi.spyOn(pool, 'query').mockImplementation(((...a: unknown[]) => { sql.push(text(a[0])); return q(...a) }) as never)
  const connect = pool.connect.bind(pool) as (...a: unknown[]) => unknown
  vi.spyOn(pool, 'connect').mockImplementation(((...a: unknown[]) => {
    if (a.length > 0) return connect(...a)
    checkouts++
    if (opts.failCheckout) return Promise.reject(new Error('pool exhausted'))
    return (connect() as Promise<{ query: (...x: unknown[]) => unknown }>).then((c) => {
      const cq = c.query.bind(c)
      c.query = ((...x: unknown[]) => { sql.push(text(x[0])); return cq(...x) }) as never
      return c
    })
  }) as never)
  return { sql, checkouts: () => checkouts }
}
const isWriteOrLock = (sql: string) => /^\s*(INSERT|UPDATE|DELETE|BEGIN|COMMIT|SAVEPOINT|LOCK)\b/i.test(sql) || /FOR\s+UPDATE|pg_advisory/i.test(sql)

describe('EMERGENCY_READ_ONLY=true: get performs no write of any kind', () => {
  beforeEach(() => { process.env.EMERGENCY_READ_ONLY = 'true' })

  it('returns an unstamped row, leaves google_sub NULL and updated_at untouched, and sends only a plain SELECT', async () => {
    await seed(ASHA.fbUid, SAVED)
    const { sql, checkouts } = watchPool()
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect(sql.some((s) => /SELECT .*FROM google_integration_settings/i.test(s))).toBe(true)
    expect(sql.filter(isWriteOrLock)).toEqual([])
    expect(checkouts()).toBe(0)
    const [row] = await rows()
    expect(row.google_sub).toBeNull()
    expect(new Date(row.updated_at).toISOString()).toBe('2026-01-02T03:04:05.000Z')
  })

  it('an OAuth identity still reads a row already stamped under Firebase (linking needs no write), and writes nothing', async () => {
    await seed(ASHA.fbUid, SAVED, SUB)
    const { sql } = watchPool()
    const ctx = await gomsContextForEmail(ASHA.email, ASHA.gUid)
    await expect(api(ctx).get({ accountUid: ASHA.gUid })).resolves.toEqual(SAVED)
    expect(sql.filter(isWriteOrLock)).toEqual([])
  })

  it('a person with no row gets the defaults and nothing is created', async () => {
    const { sql } = watchPool()
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(DEFAULT_GOOGLE_INTEGRATIONS)
    expect(sql.filter(isWriteOrLock)).toEqual([])
    expect(await rows()).toEqual([])
  })

  it('still fails closed on a row stamped with a different subject', async () => {
    await seed(ASHA.fbUid, SAVED, '999999')
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).rejects.toMatchObject({ code: 'FORBIDDEN' })
  })

  it('save is refused outright and the row is unchanged', async () => {
    await seed(ASHA.fbUid, SAVED)
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).save({ accountUid: ASHA.fbUid, settings: { ...SAVED, docsId: 'changed' } })).rejects.toMatchObject({ code: 'FORBIDDEN' })
    expect((await rows())[0]).toMatchObject({ settings: SAVED, google_sub: null })
  })
})

describe('outside read-only mode the stamp is best effort and never fails a successful read', () => {
  beforeEach(() => { delete process.env.EMERGENCY_READ_ONLY })

  it('a failing UPDATE (database refuses the stamp) still returns the settings, logs one fixed line, leaves the row unstamped, and a later read stamps it', async () => {
    await seed(ASHA.fbUid, SAVED)
    await pool.query(`CREATE FUNCTION test_refuse_stamp() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'stamp refused by test'; END $$`)
    await pool.query('CREATE TRIGGER test_refuse_stamp BEFORE UPDATE ON google_integration_settings FOR EACH ROW EXECUTE FUNCTION test_refuse_stamp()')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect((await rows())[0].google_sub).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
    const logged = String(warn.mock.calls[0][0])
    expect(JSON.parse(logged)).toEqual({ event: 'googleIntegrations.stamp_skipped' })
    expect(logged).not.toContain(SUB); expect(logged).not.toContain(ASHA.email); expect(logged).not.toContain('refused')

    await pool.query('DROP TRIGGER test_refuse_stamp ON google_integration_settings')
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect((await rows())[0].google_sub).toBe(SUB)
  })

  it('no free connection for the stamp (pool exhausted) still returns the settings', async () => {
    await seed(ASHA.fbUid, SAVED)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { checkouts } = watchPool({ failCheckout: true })
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect(checkouts()).toBe(1) // the stamp tried, and failed, to get a connection
    expect((await rows())[0].google_sub).toBeNull()
  })

  it('normal behaviour is unchanged: the read stamps the sub (EMERGENCY_READ_ONLY=false too)', async () => {
    process.env.EMERGENCY_READ_ONLY = 'false'
    await seed(ASHA.fbUid, SAVED)
    await expect(api(firebase(ASHA.fbUid, ASHA.email)).get({ accountUid: ASHA.fbUid })).resolves.toEqual(SAVED)
    expect((await rows())[0].google_sub).toBe(SUB)
  })
})
