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
    it("mode: 'mobile' explicit behaves identically to unset (same truncate-then-check-length-10 logic)", () => {
      expect(isValidPhone('9876543210', 'mobile')).toBe(true)
      expect(isValidPhone('12345', 'mobile')).toBe(false)
    })
    it('formatPhone still caps at 10 digits and applies the +91 prefix', () => {
      expect(formatPhone('9876543210')).toBe('+91 9876543210')
      expect(formatPhone('091987654321099')).toBe('+91 0919876543')
      expect(formatPhone('')).toBe('')
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
    it('formatPhone returns bare digits — never a +91 prefix — and caps at 8 digits', () => {
      expect(formatPhone('2345678', 'landlineLocal')).toBe('2345678')
      expect(formatPhone('123456789', 'landlineLocal')).toBe('12345678')
      expect(formatPhone('', 'landlineLocal')).toBe('')
    })
  })
})
