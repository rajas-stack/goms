import { TEAM_DEPARTMENT, type OrgPerson } from '@/data/org-structure'
import type { DeliveryTeamKey, DeliveryTeamMember } from '@/lib/types'

const normalized = (value: string | null | undefined) =>
  (value ?? '').normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase()

/** Keep roster ids for assignments, but use the current employee department when available. */
export function opportunityTeamMembers(
  team: DeliveryTeamKey, members: readonly DeliveryTeamMember[], people?: readonly OrgPerson[],
): DeliveryTeamMember[] {
  return members.filter(member => {
    if (member.team !== team || member.status !== 'active') return false
    if (!people) return true
    const employee = member.orgPersonId
      ? people.find(person => person.id === member.orgPersonId)
      : people.find(person => normalized(member.email) && normalized(person.email) === normalized(member.email))
        ?? people.find(person => normalized(person.name) === normalized(member.name)
          && (!normalized(person.email) || !normalized(member.email)))
    if (!employee) return !member.orgPersonId
    return employee.status === 'active'
      && employee.departments.some(department => normalized(department) === normalized(TEAM_DEPARTMENT[team]))
  }).sort((a, b) => a.name.localeCompare(b.name))
}
