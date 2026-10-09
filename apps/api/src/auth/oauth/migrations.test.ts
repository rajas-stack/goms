// apps/api/src/auth/oauth/migrations.test.ts
import { describe, expect, it } from 'vitest'
import { pool } from '../../db.js'

const exists = async (t: string) => (await pool.query('SELECT to_regclass($1) AS r', [t])).rows[0].r !== null
const isoIn = (s: number) => `now() + interval '${s} seconds'`

describe('OAuth migration 1791100000000', () => {
  it('creates the three tables', async () => {
    for (const t of ['auth_flows', 'auth_exchange_codes', 'auth_sessions']) expect(await exists(t), t).toBe(true)
  })
  it('auth_sessions.refresh_hash is unique (the compare-and-set and reuse lookup rely on it)', async () => {
    const fam = '11111111-1111-1111-1111-111111111111'
    const ins = (h: string) => pool.query(
      `INSERT INTO auth_sessions (uid, email, refresh_hash, family_id, expires_at) VALUES ('g:t','mig@amnex.com',$1,$2,${isoIn(60)})`, [h, fam])
    await ins('hash-a')
    await expect(ins('hash-a')).rejects.toThrow(/unique|duplicate/i)
    await pool.query(`DELETE FROM auth_sessions WHERE email='mig@amnex.com'`)
  })
  it('rejects an unknown client kind and a non-normalised email', async () => {
    await expect(pool.query(
      `INSERT INTO auth_flows (state_hash, code_verifier, nonce, client, expires_at) VALUES ('s','v','n','tablet',${isoIn(60)})`)).rejects.toThrow(/check/i)
    await expect(pool.query(
      `INSERT INTO auth_exchange_codes (code_hash, uid, email, family_id, client, expires_at)
       VALUES ('c','g:t','Mixed@Amnex.com','11111111-1111-1111-1111-111111111111','web',${isoIn(60)})`)).rejects.toThrow(/check/i)
  })
})
