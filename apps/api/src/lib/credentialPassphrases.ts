import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { pool } from '../db.js'
import type { PoolClient } from 'pg'
import type { TenderCredentialLock } from '@goms/domain'

export const credentialEnvelope = z.object({ version: z.literal(1), salt: z.string().regex(/^[A-Za-z0-9+/]{22}==$/),
  iv: z.string().regex(/^[A-Za-z0-9+/]{16}$/), ciphertext: z.string().min(24).max(32768).regex(/^[A-Za-z0-9+/]+={0,2}$/),
  passphraseId: z.string().uuid().optional(), passphraseRevision: z.string().max(32768).optional() }).strict()

/** Serializes creation, rotation and portal writes to avoid stale encrypted keys. */
export async function credentialTransaction<T>(action: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(1791590700)')
    const result = await action(client)
    await client.query('COMMIT')
    return result
  } catch (error) { await client.query('ROLLBACK'); throw error }
  finally { client.release() }
}
export async function validateManagedCredential(client: PoolClient, lock?: TenderCredentialLock | null) {
  if (!lock?.passphraseId) return
  const { rows } = await client.query('SELECT proof FROM credential_passphrases WHERE id=$1', [lock.passphraseId])
  if (!rows[0] || rows[0].proof.ciphertext !== lock.passphraseRevision) throw new TRPCError({ code: 'CONFLICT', message: 'The passphrase changed. Reload and enter its current value.' })
}
