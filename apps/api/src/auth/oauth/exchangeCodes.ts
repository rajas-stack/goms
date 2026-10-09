import { pool } from '../../db.js'
import { randomToken, sha256Hex } from './crypto.js'
import { parseClient, type ClientKind } from './redirect.js'

/** The GOMS one-time exchange code. NOT PKCE-bound: protected by randomness, hashing at rest, a 60 s life, atomic single use,
 *  and binding to the verified identity, family and client kind. No token exists until it is redeemed. */
export async function createExchangeCode(i: { uid: string; email: string; familyId: string; client: ClientKind }): Promise<string> {
  await pool.query(`DELETE FROM auth_exchange_codes WHERE expires_at < now() - interval '1 hour'`)
  const code = randomToken()
  await pool.query(
    `INSERT INTO auth_exchange_codes (code_hash, uid, email, family_id, client, expires_at)
     VALUES ($1, $2, $3, $4, $5, now() + interval '60 seconds')`,
    [sha256Hex(code), i.uid, i.email, i.familyId, i.client],
  )
  return code
}

/** One statement, so two simultaneous redemptions cannot both get a row. A wrong client kind is indistinguishable from an unknown code. */
export async function redeemExchangeCode(code: unknown, client: unknown): Promise<{ uid: string; email: string; familyId: string } | null> {
  const kind = parseClient(client)
  if (!kind || typeof code !== 'string' || code.length === 0 || code.length > 128) return null
  const { rows } = await pool.query(
    `UPDATE auth_exchange_codes SET used_at = now()
      WHERE code_hash = $1 AND client = $2 AND used_at IS NULL AND expires_at > now()
      RETURNING uid, email, family_id`,
    [sha256Hex(code), kind],
  )
  const row = rows[0]
  return row ? { uid: row.uid, email: row.email, familyId: row.family_id } : null
}
