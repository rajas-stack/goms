// Amnex Departments master in local (no API) mode: pure functions over the stored records and the org people, mirroring
// apps/api/src/routers/amnexDepartments.ts. Every change returns new arrays; the repository swaps them in.
import {
  DEFAULT_AMNEX_DEPARTMENTS, SYSTEM_DEPARTMENT_LOCKED, normalizeDepartmentName, sameDepartment, systemKeyFor, type AmnexDepartment,
} from '@goms/domain'
import { uid } from '@/lib/utils'
import type { OrgPerson } from '../org-structure'

/** What is stored: the count is derived from the org people on every read. */
export type StoredDepartment = Omit<AmnexDepartment, 'employeeCount'>

interface State { departments: readonly StoredDepartment[]; people: readonly OrgPerson[] }
interface Changed { departments: StoredDepartment[]; people: OrgPerson[] }

const stored = (name: string, sortOrder: number, now: string): StoredDepartment =>
  ({ id: uid('dept'), name, systemKey: systemKeyFor(name), sortOrder, createdAt: now, updatedAt: now })

/** The defaults plus every other department an employee already has (same as the migration's seed). */
export function seedDepartments(people: readonly OrgPerson[]): StoredDepartment[] {
  const now = new Date().toISOString()
  const base = DEFAULT_AMNEX_DEPARTMENTS.map((name, i) => stored(name, i, now))
  const extra = people.flatMap((p) => p.departments.map((d) => d.trim())).filter(Boolean)
    .reduce<string[]>((acc, d) => (acc.some((x) => sameDepartment(x, d)) ? acc : [...acc, d]), [])
    .filter((d) => !base.some((b) => sameDepartment(b.name, d)))
    .sort((a, b) => a.localeCompare(b))
  return [...base, ...extra.map((name, i) => stored(name, 100 + i, now))]
}

const countFor = (name: string, people: readonly OrgPerson[]) => people.filter((p) => p.departments.some((d) => sameDepartment(d, name))).length

export function listDepartmentsLocal({ departments, people }: State): AmnexDepartment[] {
  return [...departments]
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name))
    .map((d) => ({ ...d, employeeCount: countFor(d.name, people) }))
}

function assertUnique(departments: readonly StoredDepartment[], name: string, exceptId?: string) {
  if (departments.some((d) => d.id !== exceptId && sameDepartment(d.name, name))) throw new Error(`"${name}" is already a department.`)
}

function editable(departments: readonly StoredDepartment[], id: string): StoredDepartment {
  const found = departments.find((d) => d.id === id)
  if (!found) throw new Error('That department no longer exists.')
  if (found.systemKey) throw new Error(SYSTEM_DEPARTMENT_LOCKED)
  return found
}

export function createDepartmentLocal(departments: readonly StoredDepartment[], rawName: string): { departments: StoredDepartment[]; created: StoredDepartment } {
  const name = normalizeDepartmentName(rawName)
  assertUnique(departments, name)
  const created = { ...stored(name, Math.max(-1, ...departments.map((d) => d.sortOrder)) + 1, new Date().toISOString()), systemKey: null }
  return { departments: [...departments, created], created }
}

/** Renames a custom department and the name on every employee who has it. */
export function renameDepartmentLocal({ departments, people }: State, id: string, rawName: string): Changed {
  const current = editable(departments, id)
  const name = normalizeDepartmentName(rawName)
  assertUnique(departments, name, id)
  const now = new Date().toISOString()
  return {
    departments: departments.map((d) => (d.id === id ? { ...d, name, updatedAt: now } : d)),
    people: people.map((p) => (p.departments.some((d) => sameDepartment(d, current.name))
      ? { ...p, departments: [...new Set(p.departments.map((d) => (sameDepartment(d, current.name) ? name : d)))] }
      : p)),
  }
}

export function reorderDepartmentsLocal(departments: readonly StoredDepartment[], ids: readonly string[]): StoredDepartment[] {
  const rank = new Map(ids.map((id, i) => [id, i]))
  return departments.map((d) => (rank.has(d.id) ? { ...d, sortOrder: rank.get(d.id)! } : d))
}

/** Deletes a custom department and removes it from every employee who had it. */
export function deleteDepartmentLocal({ departments, people }: State, id: string): Changed & { removedFromEmployees: number } {
  const current = editable(departments, id)
  const affected = people.filter((p) => p.departments.some((d) => sameDepartment(d, current.name)))
  return {
    departments: departments.filter((d) => d.id !== id),
    people: people.map((p) => (affected.includes(p) ? { ...p, departments: p.departments.filter((d) => !sameDepartment(d, current.name)) } : p)),
    removedFromEmployees: affected.length,
  }
}
