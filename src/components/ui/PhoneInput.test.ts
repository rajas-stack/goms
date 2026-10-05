import { describe, expect, it } from 'vitest'
import { formatPhone, isValidPhone } from './PhoneInput'

describe('PhoneInput validation', () => {
  describe('mode unset (default) — unchanged 10-digit-only behavior', () => {
    it('accepts a valid 10-digit mobile number', () => {
      expect(isValidPhone('9876543210')).toBe(true)
      expect(isValidPhone('+91 9876543210')).toBe(true)
    })
    it('accepts empty (optional field)', () => {
      expect(isValidPhone('')).toBe(true)
      expect(isValidPhone('   ')).toBe(true)
    })
    it('rejects too-short input', () => {
      expect(isValidPhone('12345')).toBe(false)
    })
    it("mode: 'mobile' explicit behaves identically to unset", () => {
      expect(isValidPhone('9876543210', 'mobile')).toBe(true)
      expect(isValidPhone('12345', 'mobile')).toBe(false)
    })
    it('formatPhone removes a leading trunk zero and punctuation without truncating extra digits', () => {
      expect(formatPhone('9876543210')).toBe('+91 9876543210')
      expect(formatPhone('079-23259999')).toBe('+91 7923259999')
      expect(formatPhone('079.232599990')).toBe('+91 79232599990')
      expect(formatPhone('+91 079/23259999')).toBe('+91 7923259999')
      expect(formatPhone('')).toBe('')
    })
    it('rejects overlong mobile input instead of truncating it to a valid number', () => {
      expect(isValidPhone('079-23259999')).toBe(true)
      expect(isValidPhone('079-232599990')).toBe(false)
    })
  })

  describe("mode: 'landlineLocal' — local number only, STD code is a separate field", () => {
    it('accepts a valid local number at the 6-digit floor', () => {
      expect(isValidPhone('234567', 'landlineLocal')).toBe(true)
    })
    it('accepts a valid local number at the 8-digit ceiling', () => {
      expect(isValidPhone('23456789', 'landlineLocal')).toBe(true)
    })
    it('rejects below the 6-digit floor', () => {
      expect(isValidPhone('12345', 'landlineLocal')).toBe(false)
    })
    it('accepts empty (optional field)', () => {
      expect(isValidPhone('', 'landlineLocal')).toBe(true)
    })
    it('formatPhone returns bare digits — never a +91 prefix — and preserves overlong input for validation', () => {
      expect(formatPhone('2345678', 'landlineLocal')).toBe('2345678')
      expect(formatPhone('123456789', 'landlineLocal')).toBe('123456789')
      expect(isValidPhone('123456789', 'landlineLocal')).toBe(false)
      expect(formatPhone('', 'landlineLocal')).toBe('')
    })
  })
})
