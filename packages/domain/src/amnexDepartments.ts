import { DERIVED_ROLE_DEPARTMENTS } from './rbac/policy.js'
import type { Role } from './rbac/types.js'

/** One entry of the Amnex Departments master (Settings > Masters > Employee Master). `org_people.departments` stores the
 *  department NAME, so the master is the list of names offered to employees. */
export interface AmnexDepartment {
  id: string
  name: string
  /** Set for the departments that derive RBAC roles (DERIVED_ROLE_DEPARTMENTS key: presales / bid / legal / cxo) and feed
   *  the Pre-Sales / Bid / Legal rosters. Such a department cannot be renamed or deleted. Null for custom departments. */
  systemKey: string | null
  sortOrder: number
  /** How many org people (Teams > Employees) are in it. */
  employeeCount: number
  createdAt: string
  updatedAt: string
}

export const DEPARTMENT_NAME_MAX = 80

/** The system departments: their names are what role derivation and the roster sync match, so they are locked. */
export const SYSTEM_DEPARTMENTS: readonly { key: string; name: string }[] = Object.entries(DERIVED_ROLE_DEPARTMENTS)
  .map(([key, name]) => ({ key, name }))

/** The master's starting list (the departments the org chart was seeded with). */
export const DEFAULT_AMNEX_DEPARTMENTS = [
  'Leadership', 'Sales', 'Pre-Sales', 'Bid Management', 'Legal', 'Finance', 'Technology', 'Business Units',
] as const

/** Department → the RBAC role a template applied "to the whole department" also goes to (Roles & Access > Apply template).
 *  Matched case-insensitively by name. Departments not listed here only filter the people list. */
export const DEPARTMENT_ROLE_MAP: Readonly<Record<string, Role>> = {
  'Sales': 'sales',
  'Pre-Sales': 'presales',
  'Bid Management': 'bid',
  'Legal': 'legal',
  'Leadership': 'cxo',
  'Finance': 'finance',
}

export function roleForDepartment(name: string): Role | null {
  const key = name.trim().toLowerCase()
  const hit = Object.entries(DEPARTMENT_ROLE_MAP).find(([dept]) => dept.toLowerCase() === key)
  return hit ? hit[1] : null
}

export const systemKeyFor = (name: string): string | null =>
  SYSTEM_DEPARTMENTS.find((d) => d.name.toLowerCase() === name.trim().toLowerCase())?.key ?? null

/** Trims and collapses whitespace; throws a user-facing message when the name is empty or too long. */
export function normalizeDepartmentName(raw: string): string {
  const name = String(raw ?? '').replace(/\s+/g, ' ').trim()
  if (!name) throw new Error('Enter a department name.')
  if (name.length > DEPARTMENT_NAME_MAX) throw new Error(`Keep the department name to ${DEPARTMENT_NAME_MAX} characters.`)
  return name
}

export const sameDepartment = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase()

export const SYSTEM_DEPARTMENT_LOCKED = 'This department drives roles and team rosters, so it cannot be renamed or deleted.'
