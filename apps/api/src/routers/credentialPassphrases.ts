import { z } from 'zod'
import { TRPCError } from '@trpc/server'
import { MAX_CREDENTIAL_PASSPHRASES, normalizeCredentialPassphrase, type CredentialPassphrase } from '@goms/domain'
import { protectedProcedure, protectedReadProcedure, router } from '../trpc.js'
import { pool } from '../db.js'
import { isUniqueViolation } from '../db-errors.js'
import { credentialEnvelope, credentialTransaction } from '../lib/credentialPassphrases.js'

const shape = z.object({ name: z.string().trim().min(1).max(100), proof: credentialEnvelope.omit({ passphraseId: true, passphraseRevision: true }) })
const map = (row: any): CredentialPassphrase => ({ id: row.id, name: row.name, proof: row.proof, updatedAt: new Date(row.updated_at).toISOString() })
const conflict = (message: string) => new TRPCError({ code: 'CONFLICT', message })
async function unique<T>(action: () => Promise<T>): Promise<T> {
  try { return await action() } catch (error) {
    if (isUniqueViolation(error)) throw conflict('That passphrase name already exists.')
    throw error
  }
}
export const credentialPassphrasesRouter = router({
  list: protectedReadProcedure.query(async () => (await pool.query('SELECT * FROM credential_passphrases ORDER BY slot')).rows.map(map)),
  create: protectedProcedure.input(shape).mutation(({ input }) => unique(() => credentialTransaction(async client => {
    const clean = normalizeCredentialPassphrase(input)
    const { rows } = await client.query('SELECT slot FROM credential_passphrases')
    if (rows.length >= MAX_CREDENTIAL_PASSPHRASES) throw conflict('A maximum of 5 passphrases is allowed.')
    const slot = [1, 2, 3, 4, 5].find(value => !rows.some(row => row.slot === value))!
    return map((await client.query('INSERT INTO credential_passphrases (slot,name,proof) VALUES ($1,$2,$3) RETURNING *', [slot, clean.name, clean.proof])).rows[0])
  }))),
  update: protectedProcedure.input(shape.extend({ id: z.string().uuid(), expectedUpdatedAt: z.string(), replacements: z.array(z.object({
    id: z.string().uuid(), previousCiphertext: z.string().max(32768), credentials: credentialEnvelope,
  })).max(1000) })).mutation(({ input }) => unique(() => credentialTransaction(async client => {
    const clean = normalizeCredentialPassphrase(input)
    const record = (await client.query('SELECT * FROM credential_passphrases WHERE id=$1 FOR UPDATE', [input.id])).rows[0]
    if (!record) throw new TRPCError({ code: 'NOT_FOUND', message: 'That passphrase no longer exists.' })
    if (new Date(record.updated_at).toISOString() !== input.expectedUpdatedAt) throw conflict('The passphrase changed. Reload before saving.')
    const sites = (await client.query("SELECT id, credentials FROM tender_websites WHERE credentials->>'passphraseId'=$1 FOR UPDATE", [input.id])).rows
    if (clean.proof.ciphertext !== record.proof.ciphertext) {
      if (sites.length !== input.replacements.length || new Set(input.replacements.map(item => item.id)).size !== sites.length) throw conflict('Connected websites changed. Reload before updating the passphrase.')
      for (const site of sites) {
        const replacement = input.replacements.find(item => item.id === site.id)
        if (!replacement || replacement.previousCiphertext !== site.credentials.ciphertext || replacement.credentials.passphraseId !== input.id
          || replacement.credentials.passphraseRevision !== clean.proof.ciphertext) throw conflict('Connected credentials changed. Reload before saving.')
        await client.query('UPDATE tender_websites SET credentials=$1, updated_at=now() WHERE id=$2', [replacement.credentials, site.id])
      }
    } else if (input.replacements.length) throw conflict('Invalid credential replacement.')
    return map((await client.query('UPDATE credential_passphrases SET name=$1, proof=$2, updated_at=now() WHERE id=$3 RETURNING *', [clean.name, clean.proof, input.id])).rows[0])
  }))),
  remove: protectedProcedure.input(z.object({ id: z.string().uuid() })).mutation(({ input }) => credentialTransaction(async client => {
    const { rows } = await client.query("SELECT id FROM tender_websites WHERE credentials->>'passphraseId'=$1 LIMIT 1", [input.id])
    if (rows.length) throw conflict('This passphrase protects saved credentials and cannot be removed.')
    await client.query('DELETE FROM credential_passphrases WHERE id=$1', [input.id])
  })),
})
