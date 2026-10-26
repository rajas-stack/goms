import { describe, expect, it } from 'vitest'
import { convertCustomFieldValue, customTypesCompatible } from './bidCustomFields'

describe('custom column type changes', () => {
  it('retains compatible numbers and dropdown choices, including retired options', () => {
    expect(convertCustomFieldValue('number', 'currency', 1250.5)).toBe(1250.5)
    expect(convertCustomFieldValue('select', 'multiselect', 'Retired choice')).toBe('["Retired choice"]')
    expect(convertCustomFieldValue('multiselect', 'select', '["One"]')).toBe('One')
    expect(convertCustomFieldValue('email', 'text', 'a@example.com')).toBe('a@example.com')
  })
  it('rejects lossy compatible conversions rather than discarding existing values', () => {
    expect(() => convertCustomFieldValue('multiselect', 'select', '["One","Two"]')).toThrow(/one selection/)
    expect(() => convertCustomFieldValue('text', 'email', 'not an email')).toThrow()
  })
  it.each([['person', 'department'], ['state', 'number'], ['date', 'text'], ['text', 'number'], ['select', 'text']] as const)('resets unrelated %s → %s values', (from, to) => {
    expect(customTypesCompatible(from, to)).toBe(false)
    expect(convertCustomFieldValue(from, to, '123')).toBeNull()
  })
})
