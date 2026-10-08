import { webcrypto } from 'node:crypto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeTenderWebsiteInput } from '@goms/domain'
import { lockCredentials, unlockCredentials } from './credentialLock'

describe('tender credential locks', () => {
  beforeEach(() => vi.stubGlobal('crypto', webcrypto))
  afterEach(() => vi.unstubAllGlobals())

  it('round trips both fields with the passphrase and never serializes either secret', async () => {
    const credentials = { userId: 'portal-user', password: 'portal-secret' }
    const locked = await lockCredentials(credentials, 'a long private passphrase')
    expect(JSON.stringify(locked)).not.toContain(credentials.userId)
    expect(JSON.stringify(locked)).not.toContain(credentials.password)
    expect(await unlockCredentials(locked, 'a long private passphrase')).toEqual(credentials)
    expect(normalizeTenderWebsiteInput({ name: 'Portal', url: 'https://portal.example', credentials: locked }).credentials).toEqual(locked)
    await expect(unlockCredentials(locked, 'wrong passphrase')).rejects.toThrow(/Check the passphrase/)
    const tampered = { ...locked, ciphertext: (locked.ciphertext[0] === 'A' ? 'B' : 'A') + locked.ciphertext.slice(1) }
    await expect(unlockCredentials(tampered, 'a long private passphrase')).rejects.toThrow(/Could not unlock/)
  })

  it('rejects short passphrases and uses a fresh salt and IV for each save', async () => {
    await expect(lockCredentials({ userId: '', password: 'x' }, 'short')).rejects.toThrow(/at least 8/)
    const a = await lockCredentials({ userId: 'x', password: 'y' }, 'private passphrase')
    const b = await lockCredentials({ userId: 'x', password: 'y' }, 'private passphrase')
    expect(a.salt).not.toBe(b.salt)
    expect(a.iv).not.toBe(b.iv)
    expect(a.ciphertext).not.toBe(b.ciphertext)
  })

  it('preserves the credentials when rotating the passphrase and rejects the previous key', async () => {
    const credentials = { userId: 'portal-user', password: 'portal-secret' }
    const original = await lockCredentials(credentials, 'original passphrase')
    const rotated = await lockCredentials(await unlockCredentials(original, 'original passphrase'), 'replacement passphrase')
    expect(await unlockCredentials(rotated, 'replacement passphrase')).toEqual(credentials)
    await expect(unlockCredentials(rotated, 'original passphrase')).rejects.toThrow(/Check the passphrase/)
  })
})
