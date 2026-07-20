import type { DepartmentWork } from '@/lib/types'

/** Sales-ownership roles kept per department. Values are employee ids stored
 *  on the department node's metadata under these keys. */
export const SALES_ROLES: { key: string; label: string }[] = [
  { key: 'salesGeo', label: 'Geo Sales' },
  { key: 'salesBU', label: 'BU Sales' },
  { key: 'salesGM', label: 'GM' },
  { key: 'salesRM', label: 'RM' },
  { key: 'salesHead', label: 'Sales Head' },
]

/** Default dropdown options for a work line-item. Editable defaults — not a
 *  closed enum; an existing saved value is always kept selectable. */
export const WORK_COMPONENTS = [
  'Hardware', 'Software', 'Services', 'System Integration', 'AMC',
  'Supply', 'Installation', 'Consulting', 'License', 'Support', 'Other',
]

export const WORK_VERTICALS = [
  'Traffic', 'Transit (Mobility)', 'Data Fabric & AI', 'Integrated (Smart City)',
  'GIS', 'Agriculture', 'RNU (Resource & Utility)', 'Cloud', 'Other',
]

export function parseWorks(raw: string | undefined): DepartmentWork[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? (parsed as DepartmentWork[]) : []
  } catch {
    return []
  }
}

export function serializeWorks(works: DepartmentWork[]): string {
  return works.length ? JSON.stringify(works) : ''
}

/** Merge a saved value into an options list so a legacy/custom value never
 *  disappears from a <select>. */
export function withValue(options: string[], value: string): string[] {
  return value && !options.includes(value) ? [value, ...options] : options
}
