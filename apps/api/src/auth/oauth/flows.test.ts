import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { pool } from '../../db.js'
import { cleanupOauthTables } from '../../testHelpers/oauthTestHelpers.js'
import { pkceChallenge, sha256Hex } from './crypto.js'
import { consumeFlow, createFlow } from './flows.js'

beforeEach(cleanupOauthTables)
afterEach(cleanupOauthTables)

describe('flows', () => {
  it('stores the state only as a hash, and returns a verifier whose S256 challenge it hands out', async () => {
    const f = await createFlow('web', '/sales/roster')
    expect(f.challenge).toBe(pkceChallenge(f.verifier))
    const row = (await pool.query('SELECT * FROM auth_flows')).rows[0]
    expect(row.state_hash).toBe(sha256Hex(f.state))
    expect(JSON.stringify(row)).not.toContain(f.state)
    expect(row).toMatchObject({ client: 'web', return_to: '/sales/roster', nonce: f.nonce })
  })
  it('consumeFlow returns the server-held values exactly once', async () => {
    const f = await createFlow('app', '/')
    await expect(consumeFlow(f.state)).resolves.toEqual({ verifier: f.verifier, nonce: f.nonce, client: 'app', returnTo: '/' })
    await expect(consumeFlow(f.state)).resolves.toBeNull()
  })
  it('two simultaneous callbacks for one state: exactly one wins', async () => {
    for (let i = 0; i < 20; i++) {
      const f = await createFlow('web', '/')
      const results = await Promise.all([consumeFlow(f.state), consumeFlow(f.state)])
      expect(results.filter(Boolean)).toHaveLength(1)
    }
  })
  it('refuses an expired, unknown or non-string state', async () => {
    const f = await createFlow('web', '/')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 second'`)
    await expect(consumeFlow(f.state)).resolves.toBeNull()
    for (const bad of [undefined, null, 5, '', 'nope', 'x'.repeat(500)]) await expect(consumeFlow(bad)).resolves.toBeNull()
  })
  it('sweeps expired flows when a new one is created', async () => {
    await createFlow('web', '/')
    await pool.query(`UPDATE auth_flows SET expires_at = now() - interval '1 hour'`)
    await createFlow('web', '/')
    expect((await pool.query('SELECT count(*)::int AS n FROM auth_flows')).rows[0].n).toBe(1)
  })
})
