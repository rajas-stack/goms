import { pool } from '../../db.js'
import { pkceChallenge, randomToken, sha256Hex } from './crypto.js'
import type { ClientKind } from './redirect.js'

/** An in-flight authorization request, valid for 10 minutes. `state` is stored hashed; the PKCE verifier and nonce stay server-side. */
export async function createFlow(client: ClientKind, returnTo: string) {
  await pool.query('DELETE FROM auth_flows WHERE expires_at < now()')
  const state = randomToken(), verifier = randomToken(), nonce = randomToken()
  await pool.query(
    `INSERT INTO auth_flows (state_hash, code_verifier, nonce, client, return_to, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '10 minutes')`,
    [sha256Hex(state), verifier, nonce, client, returnTo],
  )
  return { state, verifier, nonce, challenge: pkceChallenge(verifier) }
}

/** Single-use: the row is deleted by the same statement that reads it, so concurrent callbacks cannot both succeed. */
export async function consumeFlow(state: unknown): Promise<{ verifier: string; nonce: string; client: ClientKind; returnTo: string } | null> {
  if (typeof state !== 'string' || state.length === 0 || state.length > 128) return null
  const { rows } = await pool.query(
    `DELETE FROM auth_flows WHERE state_hash = $1 AND expires_at > now() RETURNING code_verifier, nonce, client, return_to`,
    [sha256Hex(state)],
  )
  const row = rows[0]
  return row ? { verifier: row.code_verifier, nonce: row.nonce, client: row.client, returnTo: row.return_to } : null
}
