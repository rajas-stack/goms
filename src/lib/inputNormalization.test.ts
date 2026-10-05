import { describe, expect, it } from 'vitest'
import { normalizeEmail } from './inputNormalization'

describe('normalizeEmail', () => {
  it('converts [at] and [dot] notation and trims stray closing brackets', () => {
    expect(normalizeEmail('secdst[at]gujarat[dot]gov[dot]in]', true)).toBe('secdst@gujarat.gov.in')
  })

  it('infers the mailbox separator in a pasted mailbox.domain shorthand', () => {
    expect(normalizeEmail('secdst.gujarat.gov.in', true)).toBe('secdst@gujarat.gov.in')
  })

  it('leaves ordinary email addresses unchanged', () => {
    expect(normalizeEmail('secdst@gujarat.gov.in', true)).toBe('secdst@gujarat.gov.in')
  })
})