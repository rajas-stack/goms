export interface OfficeLocation {
  id: string
  label: string
  address: string
}

export function parseOfficeLocations(serialized: string | undefined, legacyAddress = ''): OfficeLocation[] {
  if (serialized) {
    try {
      const parsed: unknown = JSON.parse(serialized)
      if (Array.isArray(parsed)) {
        return parsed.filter(isOfficeLocation)
      }
    } catch {
      return legacyAddress ? [{ id: 'main-office', label: 'Main office', address: legacyAddress }] : []
    }
  }
  return legacyAddress ? [{ id: 'main-office', label: 'Main office', address: legacyAddress }] : []
}

export function serializeOfficeLocations(locations: OfficeLocation[]): string {
  return JSON.stringify(locations)
}

export function primaryOfficeAddress(locations: OfficeLocation[]): string {
  return locations.find((location) => location.address.trim())?.address ?? ''
}

function isOfficeLocation(value: unknown): value is OfficeLocation {
  if (!value || typeof value !== 'object') return false
  const location = value as Partial<OfficeLocation>
  return typeof location.id === 'string' && typeof location.label === 'string' && typeof location.address === 'string'
}