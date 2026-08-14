import type { Employee, HierNode, RelationshipQuality } from './types'

/** A single consistent accent per hierarchy level, drawn only from the design
 *  system palette (no ad-hoc colors). `chip` styles the icon container, `dot`
 *  a small swatch, and `border`/`ring` the selected-card treatment. */
export interface Accent {
  chip: string
  dot: string
  border: string
  ring: string
}

const ACCENTS: Record<string, Accent> = {
  state: { chip: 'bg-blue-100 text-blue-600', dot: 'bg-blue', border: 'border-blue', ring: 'ring-blue/20' },
  department: { chip: 'bg-indigo-100 text-indigo-600', dot: 'bg-indigo', border: 'border-indigo-600', ring: 'ring-indigo/20' },
  branch: { chip: 'bg-teal-100 text-teal-600', dot: 'bg-teal', border: 'border-teal-600', ring: 'ring-teal/20' },
  division: { chip: 'bg-teal-100 text-teal-600', dot: 'bg-teal', border: 'border-teal-600', ring: 'ring-teal/20' },
  office: { chip: 'bg-purple-100 text-purple-600', dot: 'bg-purple', border: 'border-purple-600', ring: 'ring-purple/20' },
  unit: { chip: 'bg-ink-900 text-paper', dot: 'bg-ink-900', border: 'border-ink-900', ring: 'ring-ink-900/15' },
}

const GEO_ACCENT: Accent = { chip: 'bg-teal-100 text-teal-600', dot: 'bg-teal', border: 'border-teal-600', ring: 'ring-teal/20' }
const DEFAULT_ACCENT: Accent = { chip: 'bg-ink-900 text-paper', dot: 'bg-ink-900', border: 'border-ink-600', ring: 'ring-ink-900/15' }

const EMPLOYEE_ACCENT: Accent = { chip: 'bg-emerald-100 text-emerald-600', dot: 'bg-emerald', border: 'border-emerald-600', ring: 'ring-emerald/20' }
const VACANT_ACCENT: Accent = { chip: 'bg-amber-100 text-amber-600', dot: 'bg-amber', border: 'border-amber', ring: 'ring-amber/20' }

export function nodeAccent(node: HierNode): Accent {
  if (node.domain === 'geo') return node.typeKey === 'state' ? ACCENTS.state : GEO_ACCENT
  return ACCENTS[node.typeKey] ?? DEFAULT_ACCENT
}

export function employeeAccent(e: Employee): Accent {
  return e.vacant ? VACANT_ACCENT : EMPLOYEE_ACCENT
}

/** Color-coded relationship-quality indicator dot. */
export const QUALITY_DOT: Record<RelationshipQuality, string> = {
  excellent: 'bg-emerald', good: 'bg-teal', neutral: 'bg-muted', weak: 'bg-amber', poor: 'bg-crimson',
}
