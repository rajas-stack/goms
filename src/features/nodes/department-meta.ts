import type { DepartmentWork } from '@/lib/types'

/** Sales-ownership roles kept per department. Values are employee ids stored
 *  on the department node's metadata under these keys. */
export const SALES_ROLES: { key: string; label: string }[] = [
  { key: 'salesGeo', label: 'Geo Sales' },
]

/** Default dropdown options for a work line-item. Editable defaults — not a
 *  closed enum; an existing saved value is always kept selectable. */
export const WORK_COMPONENTS = [
  'Hardware', 'Software', 'Services', 'System Integration', 'AMC',
  'Supply', 'Installation', 'Consulting', 'License', 'Support',
  // AMNEX product / OEM lines (amnex.com/products) — for works billed against a
  // specific product rather than a generic component.
  'Golden Record', 'IPMP', 'Locomate',
  'Syncnex', 'Rapidgo', 'XUP', 'Elbtros',
  'Outline', 'Spectator', 'IIon', 'Ecokeeper', 'Spotlock',
  'Agrogate', 'Agrogate Finance', 'Croptrack', 'Farmlive', 'Recloud',
  'Nirikshak', 'Eargo', 'Veintex', 'Trackous', 'Portvein', 'Samarth', 'Dairynex',
  'BlocSafe',
  'Other',
]

export const WORK_VERTICALS = [
  'Traffic', 'Transit (Mobility)', 'Data Fabric & AI', 'Integrated (Smart City)',
  'GIS', 'Agriculture', 'Resource & Utility', 'Cloud', 'Other',
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
