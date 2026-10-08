import type { TenderCredentialLock } from '@goms/domain'

export interface TenderCredentials { userId: string; password: string }
const encoder = new TextEncoder()
const decoder = new TextDecoder()
const rounds = 600_000
const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes))
const bytes = (text: string) => Uint8Array.from(atob(text), char => char.charCodeAt(0))

async function keyFor(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: rounds, hash: 'SHA-256' }, key,
    { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}

export async function lockCredentials(credentials: TenderCredentials, passphrase: string): Promise<TenderCredentialLock> {
  if (passphrase.length < 8) throw new Error('Use at least 8 characters for the credential passphrase.')
  if (credentials.userId.length > 200 || credentials.password.length > 2000) throw new Error('The User ID or password is too long.')
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await keyFor(passphrase, salt)
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoder.encode(JSON.stringify(credentials)))
  return { version: 1, salt: base64(salt), iv: base64(iv), ciphertext: base64(new Uint8Array(encrypted)) }
}

export async function unlockCredentials(lock: TenderCredentialLock, passphrase: string): Promise<TenderCredentials> {
  try {
    if (lock.version !== 1) throw new Error('Unsupported credential lock.')
    const key = await keyFor(passphrase, bytes(lock.salt))
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: bytes(lock.iv) }, key, bytes(lock.ciphertext))
    const value: unknown = JSON.parse(decoder.decode(plain))
    if (!value || typeof value !== 'object' || !('userId' in value) || !('password' in value)
      || typeof value.userId !== 'string' || typeof value.password !== 'string') throw new Error('Invalid credentials.')
    return { userId: value.userId, password: value.password }
  } catch {
    throw new Error('Could not unlock credentials. Check the passphrase.')
  }
}
