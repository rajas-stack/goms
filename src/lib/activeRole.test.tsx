import { beforeEach, describe, expect, it, vi } from 'vitest'
import { readStoredRole, resolveActiveRole, writeStoredRole } from './activeRole'

describe('resolveActiveRole', () => {
  it('honours a saved role only when the server still reports it and there is a real choice (2+ roles)', () => {
    expect(resolveActiveRole('sales', ['sales', 'bid'])).toBe('sales')
    expect(resolveActiveRole('bid', ['sales', 'bid', 'system_admin'])).toBe('bid')
  })
  it('discards a saved role the server no longer reports, or none at all', () => {
    expect(resolveActiveRole('legal', ['sales', 'bid'])).toBeNull()
    expect(resolveActiveRole(null, ['sales', 'bid'])).toBeNull()
  })
  it('never narrows when the user has zero or one role (the switcher is hidden then)', () => {
    expect(resolveActiveRole('sales', ['sales'])).toBeNull()
    expect(resolveActiveRole('sales', [])).toBeNull()
  })
  it('does not accept look-alike values from storage (prototype keys, other casing)', () => {
    expect(resolveActiveRole('__proto__', ['sales', 'bid'])).toBeNull()
    expect(resolveActiveRole('Sales', ['sales', 'bid'])).toBeNull()
  })
})

describe('stored role', () => {
  beforeEach(() => localStorage.clear())

  it('is kept per user, case-insensitively on the email', () => {
    writeStoredRole('A@amnex.com', 'sales')
    expect(readStoredRole('a@amnex.com')).toBe('sales')
    expect(readStoredRole('b@amnex.com')).toBeNull()
  })
  it('clears the selection when set back to null ("All my roles")', () => {
    writeStoredRole('a@amnex.com', 'bid')
    writeStoredRole('a@amnex.com', null)
    expect(readStoredRole('a@amnex.com')).toBeNull()
  })
  it('keeps working (as "no selection") when storage is unavailable', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readStoredRole('a@amnex.com')).toBeNull()
    expect(() => writeStoredRole('a@amnex.com', 'sales')).not.toThrow()
    get.mockRestore()
    set.mockRestore()
  })
})
