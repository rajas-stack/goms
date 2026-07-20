import type { Employee } from '@/lib/types'

/** The top of each local reporting chain within a set of employees — anyone
 *  whose manager isn't also in the set renders as a root; everyone else
 *  nests under their manager's card instead, so no one renders twice. */
export function rootReportsOf(employees: Employee[]): Employee[] {
  const ids = new Set(employees.map((e) => e.id))
  return employees.filter((e) => !e.managerId || !ids.has(e.managerId))
}
