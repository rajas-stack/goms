// apps/api/src/auth/oauth/sessions.test.ts
import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { sha256Hex } from './crypto.js'
import { SessionError, revokeFamilyByRefreshToken, rotateRefreshToken, startSession } from './sessions.js'

beforeEach(cleanupOauthTables)
afterEach(async () => { delete process.env.AUTH_REFRESH_TTL_DAYS; await cleanupOauthTables() })
const sign = (email = 'user@amnex.com') => { const familyId = randomUUID(); return startSession({ uid: 'g:1', email, familyId }).then((s) => ({ ...s, familyId })) }
const rows = async (familyId: string) => (await pool.query('SELECT * FROM auth_sessions WHERE family_id=$1 ORDER BY created_at', [familyId])).rows
const kindOf = async (p: Promise<unknown>) => p.then(() => 'ok', (e) => (e instanceof SessionError ? e.kind : 'other'))

describe('startSession', () => {
  it('stores only the hash of the refresh token and expires in 30 days by default', async () => {
    const { refreshToken, familyId } = await sign()
    const [row] = await rows(familyId)
    expect(row.refresh_hash).toBe(sha256Hex(refreshToken))
    expect(JSON.stringify(row)).not.toContain(refreshToken)
    const days = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000
    expect(Math.round(days)).toBe(30)
  })
  it('honours AUTH_REFRESH_TTL_DAYS', async () => {
    process.env.AUTH_REFRESH_TTL_DAYS = '7'
    const { familyId } = await sign()
    const [row] = await rows(familyId)
    expect(Math.round((new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000)).toBe(7)
  })
})

describe('refresh TTL parsing', () => {
  it.each([['0.5'], ['0'], ['-1'], ['abc']])('AUTH_REFRESH_TTL_DAYS=%s falls back to 30 days, never an instantly-expired session', async (raw) => {
    process.env.AUTH_REFRESH_TTL_DAYS = raw
    const s = await sign()
    const [row] = await rows(s.familyId)
    expect(Math.round((new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000)).toBe(30)
    await expect(rotateRefreshToken(s.refreshToken)).resolves.toBeTruthy() // and it really is usable
  })
})

describe('rotateRefreshToken', () => {
  it('rotates: new token, same family, old generation marked replaced, new one live', async () => {
    const { refreshToken, familyId } = await sign()
    const next = await rotateRefreshToken(refreshToken)
    expect(next).toMatchObject({ uid: 'g:1', email: 'user@amnex.com', familyId })
    expect(next.refreshToken).not.toBe(refreshToken)
    const [old, fresh] = await rows(familyId)
    expect(old.replaced_at).not.toBeNull()
    expect(fresh).toMatchObject({ replaced_at: null, revoked_at: null, refresh_hash: sha256Hex(next.refreshToken) })
  })
  it('chains: each new token rotates again', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    const b = await rotateRefreshToken(a.refreshToken)
    expect(b.familyId).toBe(s.familyId)
    expect(await rows(s.familyId)).toHaveLength(3)
  })
  it('reuse of an already-rotated token revokes the WHOLE family, including the newest generation', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('reuse')
    expect((await rows(s.familyId)).every((r) => r.revoked_at !== null)).toBe(true)
    expect(await kindOf(rotateRefreshToken(a.refreshToken))).toBe('invalid') // the newest token is dead too
  })
  it('does not touch other families when one is revoked', async () => {
    const x = await sign(), y = await sign('other@amnex.com')
    await rotateRefreshToken(x.refreshToken)
    await kindOf(rotateRefreshToken(x.refreshToken))
    expect((await rows(y.familyId))[0].revoked_at).toBeNull()
    await expect(rotateRefreshToken(y.refreshToken)).resolves.toBeTruthy()
  })
  it('refuses unknown, expired and revoked tokens with the same generic error and no side effects', async () => {
    expect(await kindOf(rotateRefreshToken('unknown'.padEnd(43, 'x')))).toBe('invalid')
    const s = await sign()
    await pool.query(`UPDATE auth_sessions SET expires_at = now() - interval '1 second' WHERE family_id=$1`, [s.familyId])
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('invalid')
    expect((await rows(s.familyId))).toHaveLength(1)
    for (const bad of [undefined, null, 5, '', 'x'.repeat(300)]) expect(await kindOf(rotateRefreshToken(bad))).toBe('invalid')
  })
  it('a directly revoked token (logout, family revocation) is "invalid" - not "reuse" - and changes nothing', async () => {
    const s = await sign()
    await pool.query(`UPDATE auth_sessions SET revoked_at = now() WHERE family_id=$1`, [s.familyId])
    const before = await rows(s.familyId)
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('invalid')
    const after = await rows(s.familyId)
    expect(after).toHaveLength(1)
    expect(after[0]).toMatchObject({ replaced_at: null, revoked_at: before[0].revoked_at, last_used_at: before[0].last_used_at })
  })
  it('if inserting the next generation fails AFTER the compare-and-set, the whole rotation rolls back and the OLD token still works', async () => {
    const s = await sign()
    const before = (await rows(s.familyId))[0]
    // Inject the fault at the connection the rotation uses: the CAS UPDATE runs for real inside the transaction, then the INSERT of the next
    // generation fails. (No DDL on the shared scratch database: a trigger would be visible to test files running in parallel.)
    type Conn = { query: (...a: unknown[]) => Promise<unknown> }
    const real = pool.connect.bind(pool) as () => Promise<Conn>
    const spy = vi.spyOn(pool, 'connect').mockImplementationOnce((async () => {
      const client = await real()
      // A Proxy, not a patched client: the pool hands this very connection to later callers, so it must stay untouched.
      return new Proxy(client, {
        get(target, prop) {
          if (prop === 'query') {
            return async (...a: unknown[]) => {
              if (typeof a[0] === 'string' && a[0].includes('INSERT INTO auth_sessions')) throw new Error('simulated insert failure')
              return target.query(...a)
            }
          }
          const v = Reflect.get(target, prop) as unknown
          return typeof v === 'function' ? v.bind(target) : v
        },
      })
    }) as never)
    try {
      await expect(rotateRefreshToken(s.refreshToken)).rejects.toThrow('simulated insert failure')
    } finally { spy.mockRestore() }
    const [row, ...rest] = await rows(s.familyId)
    expect(rest).toHaveLength(0)
    expect(row).toMatchObject({ replaced_at: null, revoked_at: null })
    expect(row.last_used_at).toEqual(before.last_used_at) // the CAS UPDATE was rolled back too
    // the client never saw a new token, and the token it still holds is not a "reuse"
    const next = await rotateRefreshToken(s.refreshToken)
    expect(next.familyId).toBe(s.familyId)
    expect(await rows(s.familyId)).toHaveLength(2)
  })
  it('a token whose account is no longer @amnex.com cannot rotate and its family is revoked', async () => {
    const s = await startSession({ uid: 'g:9', email: 'ex@gmail.com', familyId: randomUUID() })
    const fam = (await pool.query('SELECT family_id FROM auth_sessions')).rows[0].family_id
    expect(await kindOf(rotateRefreshToken(s.refreshToken))).toBe('not_amnex')
    expect((await rows(fam)).every((r) => r.revoked_at !== null)).toBe(true)
  })

  it('TWO SIMULTANEOUS refreshes with the same current token: exactly one rotates; the other fails and revokes the family (real Postgres)', async () => {
    for (let i = 0; i < 25; i++) {
      const s = await sign()
      const [a, b] = await Promise.allSettled([rotateRefreshToken(s.refreshToken), rotateRefreshToken(s.refreshToken)])
      const won = [a, b].filter((r) => r.status === 'fulfilled')
      const lost = [a, b].filter((r) => r.status === 'rejected') as PromiseRejectedResult[]
      expect(won, `iteration ${i}: winners`).toHaveLength(1)
      expect(lost, `iteration ${i}: losers`).toHaveLength(1)
      expect(lost[0].reason).toBeInstanceOf(SessionError)
      expect((lost[0].reason as SessionError).kind).toBe('reuse')
      const family = await rows(s.familyId)
      expect(family.every((r) => r.revoked_at !== null), `iteration ${i}: family revoked`).toBe(true)
      expect(family.filter((r) => r.replaced_at === null && r.revoked_at === null)).toHaveLength(0) // no usable token survives
    }
  })
  it('five simultaneous refreshes: still exactly one winner and one new generation in the table', async () => {
    const s = await sign()
    const results = await Promise.allSettled(Array.from({ length: 5 }, () => rotateRefreshToken(s.refreshToken)))
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1)
    expect(await rows(s.familyId)).toHaveLength(2) // original + the single new generation
  })
})

describe('revokeFamilyByRefreshToken (logout)', () => {
  it('revokes every generation of the family and is idempotent', async () => {
    const s = await sign()
    const a = await rotateRefreshToken(s.refreshToken)
    await revokeFamilyByRefreshToken(a.refreshToken)
    expect((await rows(s.familyId)).every((r) => r.revoked_at !== null)).toBe(true)
    await expect(revokeFamilyByRefreshToken(a.refreshToken)).resolves.toBeUndefined()
    expect(await kindOf(rotateRefreshToken(a.refreshToken))).toBe('invalid')
  })
  it('says nothing for an unknown token', async () => {
    await expect(revokeFamilyByRefreshToken('nope')).resolves.toBeUndefined()
    await expect(revokeFamilyByRefreshToken(undefined)).resolves.toBeUndefined()
  })
})
