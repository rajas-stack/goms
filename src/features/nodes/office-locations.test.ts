import { describe, expect, it } from 'vitest'
import { parseOfficeLocations, primaryOfficeAddress, serializeOfficeLocations } from './office-locations'

describe('department office locations', () => {
  it('reads a legacy single address as the main office', () => {
    expect(parseOfficeLocations(undefined, '1 Secretariat Road')).toEqual([
      { id: 'main-office', label: 'Main office', address: '1 Secretariat Road' },
    ])
  })

  it('round-trips multiple named offices and exposes the first address to legacy consumers', () => {
    const locations = [
      { id: 'main', label: 'Head office', address: '1 Secretariat Road' },
      { id: 'branch', label: 'Surat branch', address: '2 Ring Road' },
    ]
    expect(parseOfficeLocations(serializeOfficeLocations(locations))).toEqual(locations)
    expect(primaryOfficeAddress(locations)).toBe('1 Secretariat Road')
  })
})