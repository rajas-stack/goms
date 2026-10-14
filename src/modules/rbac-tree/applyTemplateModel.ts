import { roleForDepartment, sameDepartment, type RbacLinkableRef, type Role } from '@goms/domain'
import { normalizeEmailKey, type MasterEmployee } from '@/features/org/masterEmployees'

/** Levels offered by the dialog: L0–L5, plus any deeper level someone actually has. */
export function levelOptions(employees: readonly MasterEmployee[]): number[] {
  const used = employees.flatMap((e) => (e.level === null ? [] : [e.level]))
  return [...new Set([0, 1, 2, 3, 4, 5, ...used])].sort((a, b) => a - b)
}

/** Employees in ANY of the selected departments AND at ANY of the selected levels; an empty selection does not filter. */
export function filterEmployees(employees: readonly MasterEmployee[], departments: readonly string[], levels: readonly number[]): MasterEmployee[] {
  return employees.filter((e) =>
    (departments.length === 0 || e.departments.some((d) => departments.some((s) => sameDepartment(s, d))))
    && (levels.length === 0 || (e.level !== null && levels.includes(e.level))))
}

/** The roles the selected departments map to (DEPARTMENT_ROLE_MAP), and the departments that map to none. */
export function departmentRoles(departments: readonly string[]): { roles: Role[]; unmapped: string[] } {
  const roles = [...new Set(departments.flatMap((d) => { const r = roleForDepartment(d); return r ? [r] : [] }))]
  return { roles, unmapped: departments.filter((d) => !roleForDepartment(d)) }
}

/** What "Apply to N" applies to: the picked users, plus each mapped department's role when "whole department" is on. */
export function applyTargets(userIds: readonly string[], departments: readonly string[], wholeDepartment: boolean): RbacLinkableRef[] {
  const users = [...new Set(userIds.map(normalizeEmailKey).filter(Boolean))].map((id) => ({ type: 'user' as const, id }))
  const roles = wholeDepartment ? departmentRoles(departments).roles.map((id) => ({ type: 'role' as const, id })) : []
  return [...users, ...roles]
}
