import { describe, expect, it } from 'vitest'
import { pkceChallenge, randomToken, sha256Hex } from './crypto.js'

describe('crypto helpers', () => {
  it('randomToken is url-safe, 43 chars for 32 bytes, and never repeats', () => {
    const a = randomToken(), b = randomToken()
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(a).not.toBe(b)
  })
  it('sha256Hex is the standard hex digest', () => {
    expect(sha256Hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
  })
  it('pkceChallenge matches the RFC 7636 S256 example', () => {
    expect(pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
})
