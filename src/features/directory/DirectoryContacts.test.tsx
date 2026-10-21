import { describe, expect, it } from 'vitest'
import { partyForDirectoryType } from './DirectoryContacts'

describe('partyForDirectoryType', () => {
  it('maps Directory Types master codes to E-mail contact categories', () => {
    expect(partyForDirectoryType('department')).toBe('clientDepartment')
    expect(partyForDirectoryType('oem')).toBe('oem')
    expect(partyForDirectoryType('external')).toBe('external')
  })

  it('returns null for a type with no linked contacts', () => {
    expect(partyForDirectoryType('consultants')).toBeNull()
  })
})
