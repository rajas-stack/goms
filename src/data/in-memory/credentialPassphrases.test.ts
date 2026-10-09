import { beforeEach, describe, expect, it } from 'vitest'
import { repository, resetLocalData } from '@/data/repository'

const proof = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
const nextProof = { ...proof, ciphertext: 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB' }
describe('shared credential passphrases', () => {
  beforeEach(() => resetLocalData())
  it('limits the shared list to five, including simultaneous creates', async () => {
    const results = await Promise.allSettled(Array.from({ length: 6 }, (_, index) => repository.createCredentialPassphrase({ name: `Key ${index}`, proof })))
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(5)
    expect(await repository.listCredentialPassphrases()).toHaveLength(5)
    await expect(repository.createCredentialPassphrase({ name: 'Extra', proof })).rejects.toThrow('maximum of 5')
  })
  it('rotates tender and verification credentials atomically, preserving edit locks', async () => {
    const record = await repository.createCredentialPassphrase({ name: 'Shared', proof })
    const credentials = { ...proof, passphraseId: record.id, passphraseRevision: proof.ciphertext }
    const tender = await repository.createTenderWebsite({ name: 'Tender', url: 'https://tender.example', credentials })
    const verification = await repository.createTenderWebsite({ kind: 'verification', name: 'GST', url: 'https://gst.example', credentials })
    await repository.setTenderWebsiteEditingLock(tender.id, true)
    await expect(repository.deleteCredentialPassphrase(record.id)).rejects.toThrow('cannot be removed')
    const replacements = [tender, verification].map(site => ({ id: site.id, previousCiphertext: proof.ciphertext,
      credentials: { ...nextProof, passphraseId: record.id, passphraseRevision: nextProof.ciphertext } }))
    await expect(repository.updateCredentialPassphrase({ ...record, proof: nextProof, expectedUpdatedAt: record.updatedAt, replacements: replacements.slice(1) })).rejects.toThrow('Connected websites changed')
    expect((await repository.listTenderWebsites())[0].credentials).toEqual(credentials)
    await repository.updateCredentialPassphrase({ ...record, proof: nextProof, expectedUpdatedAt: record.updatedAt, replacements })
    expect((await repository.listTenderWebsites())[0]).toMatchObject({ editingLocked: true, credentials: replacements[0].credentials })
    expect((await repository.listTenderWebsites('verification'))[0].credentials).toEqual(replacements[1].credentials)
    await expect(repository.createTenderWebsite({ name: 'Stale', url: 'https://stale.example', credentials })).rejects.toThrow('passphrase changed')
  })
  it('rejects changed ciphertext and duplicate replacement IDs without partial writes', async () => {
    const record = await repository.createCredentialPassphrase({ name: 'Shared', proof })
    const site = await repository.createTenderWebsite({ name: 'Tender', url: 'https://tender.example', credentials: { ...proof, passphraseId: record.id, passphraseRevision: proof.ciphertext } })
    const replacement = { id: site.id, previousCiphertext: 'stale', credentials: { ...nextProof, passphraseId: record.id, passphraseRevision: nextProof.ciphertext } }
    await expect(repository.updateCredentialPassphrase({ ...record, proof: nextProof, expectedUpdatedAt: record.updatedAt, replacements: [replacement] })).rejects.toThrow('Connected credentials changed')
    expect((await repository.listCredentialPassphrases())[0].proof).toEqual(proof)
    expect((await repository.listTenderWebsites())[0].credentials?.ciphertext).toBe(proof.ciphertext)
    await expect(repository.createCredentialPassphrase({ name: ' shared ', proof })).rejects.toThrow('already exists')
  })
})
