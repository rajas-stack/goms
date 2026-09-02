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

  describe("mode: 'mobileOrLandline'", () => {
    it('accepts a valid 10-digit mobile number', () => {
      expect(isValidPhone('9876543210', 'mobileOrLandline')).toBe(true)
    })
    it('accepts a valid STD-prefixed landline (e.g. 0674 + 7-digit local = 11 digits)', () => {
      expect(isValidPhone('06742345678', 'mobileOrLandline')).toBe(true)
    })
    it('accepts a short landline at the 8-digit floor (2-digit STD + 6-digit local)', () => {
      expect(isValidPhone('11234567', 'mobileOrLandline')).toBe(true)
    })
    it('rejects malformed input below the 8-digit landline floor', () => {
      expect(isValidPhone('1234', 'mobileOrLandline')).toBe(false)
      expect(isValidPhone('1234567', 'mobileOrLandline')).toBe(false)
    })
    it('accepts empty (optional field)', () => {
      expect(isValidPhone('', 'mobileOrLandline')).toBe(true)
    })
    it('formatPhone allows up to 12 digits in this mode', () => {
      expect(formatPhone('067423456789', 'mobileOrLandline')).toBe('+91 067423456789')
    })
  })
})
