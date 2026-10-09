import { beforeEach, describe, expect, it, vi } from 'vitest'
const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { credentialPassphrasesRouter } from './credentialPassphrases.js'
import { opportunityPolicy } from '../auth/rbac/registry/opportunity.js'
const id = '00000000-0000-4000-8000-000000000001'
const proof = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
const record = { id, name: 'Shared', proof, updated_at: new Date('2026-10-09T00:00:00Z') }
const caller = () => credentialPassphrasesRouter.createCaller({ user: { email: 'editor@amnex.com', isAmnexAccount: true, emailVerified: true } } as any)
describe('credential passphrase API', () => {
  beforeEach(() => { vi.clearAllMocks(); db.connect.mockResolvedValue(db); db.query.mockResolvedValue({ rows: [] }) })
  it('uses the same read, create, update and delete permissions as portal settings', async () => {
    for (const [action, portalAction] of [['list', 'list'], ['create', 'create'], ['update', 'update'], ['remove', 'delete']]) {
      const requirements = (path: string) => Promise.all(opportunityPolicy[path].requirements.map(check => check({}, {} as any)))
      expect(await requirements(`credentialPassphrases.${action}`)).toEqual(await requirements(`tenderWebsites.${portalAction}`))
    }
  })
  it('refuses a sixth passphrase under a transaction and rolls back', async () => {
    db.query.mockImplementation(async sql => ({ rows: sql === 'SELECT slot FROM credential_passphrases' ? [1, 2, 3, 4, 5].map(slot => ({ slot })) : [] }))
    await expect(caller().create({ name: 'Sixth', proof })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.query).toHaveBeenCalledWith('SELECT pg_advisory_xact_lock(1791590700)')
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(db.query.mock.calls.some(call => call[0].startsWith('INSERT'))).toBe(false)
    expect(db.release).toHaveBeenCalledOnce()
  })
  it('stores only the encrypted proof, reusing an available slot', async () => {
    db.query.mockImplementation(async sql => ({ rows: sql === 'SELECT slot FROM credential_passphrases' ? [{ slot: 1 }, { slot: 3 }] : sql.startsWith('INSERT') ? [record] : [] }))
    expect(await caller().create({ name: ' Shared ', proof })).toMatchObject({ id, name: 'Shared', proof })
    expect(db.query).toHaveBeenCalledWith('INSERT INTO credential_passphrases (slot,name,proof) VALUES ($1,$2,$3) RETURNING *', [2, 'Shared', proof])
    expect(db.query).toHaveBeenCalledWith('COMMIT')
    await expect(caller().create({ name: 'Invalid', proof: { ...proof, ciphertext: 'plaintext secret' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('blocks deletion of in-use keys and stale rotations', async () => {
    db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM tender_websites') ? [{ id }] : sql.includes('FOR UPDATE') ? [record] : [] }))
    await expect(caller().remove({ id })).rejects.toMatchObject({ code: 'CONFLICT' })
    await expect(caller().update({ id, name: 'Changed', proof, expectedUpdatedAt: 'stale', replacements: [] })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.query.mock.calls.some(call => call[0].startsWith('UPDATE') || call[0].startsWith('DELETE'))).toBe(false)
  })
  it('rejects incomplete portal re-encryption without updating the proof', async () => {
    db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM credential_passphrases') ? [record] : sql.includes('FROM tender_websites') ? [{ id, credentials: proof }] : [] }))
    await expect(caller().update({ id, name: 'Changed', proof: { ...proof, ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }, expectedUpdatedAt: record.updated_at.toISOString(), replacements: [] })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.query.mock.calls.some(call => call[0].startsWith('UPDATE'))).toBe(false)
  })
  it('commits portal replacements and the new verification envelope together', async () => {
    const siteId = '00000000-0000-4000-8000-000000000002'
    const next = { ...proof, ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }
    db.query.mockImplementation(async sql => ({ rows: sql.startsWith('SELECT * FROM credential_passphrases') ? [record]
      : sql.includes('FROM tender_websites') ? [{ id: siteId, credentials: proof }]
      : sql.startsWith('UPDATE credential_passphrases') ? [{ ...record, proof: next }] : [] }))
    const credentials = { ...next, passphraseId: id, passphraseRevision: next.ciphertext }
    await caller().update({ id, name: 'Shared', proof: next, expectedUpdatedAt: record.updated_at.toISOString(), replacements: [{ id: siteId, previousCiphertext: proof.ciphertext, credentials }] })
    expect(db.query).toHaveBeenCalledWith('UPDATE tender_websites SET credentials=$1, updated_at=now() WHERE id=$2', [credentials, siteId])
    expect(db.query).toHaveBeenCalledWith('COMMIT')
    expect(db.query).not.toHaveBeenCalledWith('ROLLBACK')
  })
})
