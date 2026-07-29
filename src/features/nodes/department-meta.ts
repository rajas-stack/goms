import type { MultiSelectGroup } from '@/components/ui/MultiSelectDropdown'
import type { DepartmentWork } from '@/lib/types'

/** Sales-ownership roles kept per department. Values are employee ids stored
 *  on the department node's metadata under these keys. */
export const SALES_ROLES: { key: string; label: string }[] = [
  { key: 'salesGeo', label: 'Geo Sales' },
]

/** Default component/product-line options for a work line-item, grouped for
 *  the multiselect: an ungrouped generic section, then AMNEX's own product /
 *  OEM lines (amnex.com/products) under their own header. Editable defaults —
 *  not a closed enum; a "+ Add option" custom value is always kept selectable
 *  (appended to the ungrouped section). */
export const WORK_COMPONENT_GROUPS: MultiSelectGroup[] = [
  {
    label: null,
    options: [
      'Hardware', 'Software', 'Services', 'System Integration', 'AMC',
      'Supply', 'Installation', 'Consulting', 'License', 'Support',
    ],
  },
  {
    label: 'AMNEX products',
    options: [
      'Golden Record', 'IPMP', 'Locomate',
      'Syncnex', 'Rapidgo', 'XUP', 'Elbtros',
      'Outline', 'Spectator', 'IIon', 'Ecokeeper', 'Spotlock',
      'Agrogate', 'Agrogate Finance', 'Croptrack', 'Farmlive', 'Recloud',
      'Nirikshak', 'Eargo', 'Veintex', 'Trackous', 'Portvein', 'Samarth', 'Dairynex',
      'BlocSafe',
      'Other',
    ],
  },
]

/** Flattened, for anything that reads it as a plain list. */
export const WORK_COMPONENTS = WORK_COMPONENT_GROUPS.flatMap((g) => g.options)

export const WORK_VERTICALS = [
  'Traffic', 'Transit (Mobility)', 'Data Fabric & AI', 'Integrated (Smart City)',
  'GIS', 'Agriculture', 'Resource & Utility', 'Cloud', 'Other',
]

/** Currencies a work's value/EMD can be denominated in. */
export const WORK_CURRENCIES: { code: string; label: string }[] = [
  { code: 'INR', label: 'INR (₹)' },
  { code: 'USD', label: 'USD ($)' },
  { code: 'AED', label: 'AED (د.إ)' },
  { code: 'EUR', label: 'EUR (€)' },
  { code: 'GBP', label: 'GBP (£)' },
]

/** Scale a work's value/EMD amount is expressed in. */
export const WORK_VALUE_UNITS: { key: string; label: string }[] = [
  { key: 'cr', label: 'Cr' },
  { key: 'lakh', label: 'Lakh' },
  { key: 'thousand', label: 'Thousand' },
]

/** Read-only budget estimate from EMD info — amount × (100 ÷ percent), in
 *  the same unit the EMD amount was entered in. `null` until both fields
 *  parse as positive numbers, so the caller can hide the estimate rather
 *  than show a bogus value. */
export function estimateBudgetFromEmd(emdAmount: string, emdPercent: string): number | null {
  const amount = Number(emdAmount)
  const percent = Number(emdPercent)
  if (!(amount > 0) || !(percent > 0)) return null
  return amount * (100 / percent)
}

export function workUnitLabel(key: string): string {
  return WORK_VALUE_UNITS.find((u) => u.key === key)?.label ?? key
}

/** Display string for a work's value, e.g. "INR 50 Lakh" — empty until an
 *  amount has been entered. */
export function formatWorkValue(w: Pick<DepartmentWork, 'currency' | 'valueAmount' | 'valueUnit'>): string {
  if (!w.valueAmount) return ''
  return `${w.currency} ${w.valueAmount} ${workUnitLabel(w.valueUnit)}`
}

const ABBREVIATION_STOPWORDS = new Set(['of', 'and', 'the', 'for', 'in', 'to', '&'])

/** Auto-derived department abbreviation in the style of real ministry
 *  short names (MoSPI, DoT, …) — every word contributes its first letter,
 *  capitalized for a significant word and lowercase for a minor connector
 *  (of/and/the/for/in/to/&), e.g. "Department of National Agencies" →
 *  "DoNA". Used wherever a department's short name is shown and none has
 *  been entered by hand, so departments never need one typed in just to
 *  get a usable abbreviation. */
export function abbreviateDepartmentName(name: string): string {
  return name
    .split(/[\s,]+/)
    .filter(Boolean)
    .map((w) => (ABBREVIATION_STOPWORDS.has(w.toLowerCase()) ? w[0].toLowerCase() : w[0].toUpperCase()))
    .filter((c) => /[A-Za-z]/.test(c))
    .join('')
}

export function parseWorks(raw: string | undefined): DepartmentWork[] {
  if (!raw) return []
  try {
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    // Migrate a legacy single-string `component` (saved before it became a
    // multiselect) to a one-item array; an already-migrated array or a
    // missing key both fall through cleanly.
    return (parsed as (Omit<DepartmentWork, 'component'> & { component?: string | string[] })[]).map((w) => ({
      ...w,
      component: Array.isArray(w.component) ? w.component : w.component ? [w.component] : [],
    })) as DepartmentWork[]
  } catch {
    return []
  }
}

export function serializeWorks(works: DepartmentWork[]): string {
  return works.length ? JSON.stringify(works) : ''
}
