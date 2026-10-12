import { randomUUID } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { sha256Hex } from './crypto.js'
import { createExchangeCode, redeemExchangeCode } from './exchangeCodes.js'

beforeEach(cleanupOauthTables)
afterEach(cleanupOauthTables)
const identity = () => ({ uid: 'g:42', email: 'user@amnex.com', familyId: randomUUID() })

describe('exchange codes', () => {
  it('are random, stored only as a hash, and expire in 60 seconds', async () => {
    const i = identity()
    const code = await createExchangeCode({ ...i, client: 'web' })
    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/)
    const row = (await pool.query(`SELECT *, EXTRACT(EPOCH FROM expires_at - created_at)::int AS life FROM auth_exchange_codes`)).rows[0]
    expect(row.code_hash).toBe(sha256Hex(code))
    expect(JSON.stringify(row)).not.toContain(code)
    expect(row.life).toBe(60)
  })
  it('redeems once and returns the recorded identity and family', async () => {
    const i = identity()
    const code = await createExchangeCode({ ...i, client: 'web' })
    await expect(redeemExchangeCode(code, 'web')).resolves.toEqual(i)
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
  })
  it('is bound to the client kind it was issued for (the code is NOT PKCE-bound)', async () => {
    const code = await createExchangeCode({ ...identity(), client: 'app' })
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
    await expect(redeemExchangeCode(code, 'app')).resolves.not.toBeNull()
  })
  it('two simultaneous redemptions of one code: exactly one succeeds, against the real database', async () => {
    for (let i = 0; i < 25; i++) {
      const code = await createExchangeCode({ ...identity(), client: 'web' })
      const results = await Promise.all([redeemExchangeCode(code, 'web'), redeemExchangeCode(code, 'web'), redeemExchangeCode(code, 'web')])
      expect(results.filter(Boolean), `iteration ${i}`).toHaveLength(1)
    }
  })
  it('refuses expired, unknown and malformed codes, and a malformed client', async () => {
    const code = await createExchangeCode({ ...identity(), client: 'web' })
    await pool.query(`UPDATE auth_exchange_codes SET expires_at = now() - interval '1 second'`)
    await expect(redeemExchangeCode(code, 'web')).resolves.toBeNull()
    for (const bad of [undefined, null, 5, '', 'x'.repeat(300)]) await expect(redeemExchangeCode(bad, 'web')).resolves.toBeNull()
    const fresh = await createExchangeCode({ ...identity(), client: 'web' })
    for (const badClient of [undefined, 'tablet', 7]) await expect(redeemExchangeCode(fresh, badClient)).resolves.toBeNull()
  })
})
