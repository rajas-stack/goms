import { useMemo } from 'react'
import { useDeliveryTeamMembers, useOrgPeople, useSalesPersons } from '@/lib/api'
import type { OrgPerson } from '@/data/org-structure'
import { buildMasterEmployees, type MasterEmployee } from './masterEmployees'

const NONE: OrgPerson[] = []

/** Every person in GOMS, de-duplicated (see masterEmployees.ts). A roster the caller may not read (e.g. Sales for Legal)
 *  simply contributes nobody. */
export function useMasterEmployees(): { employees: MasterEmployee[]; orgPeople: OrgPerson[]; isLoading: boolean } {
  const org = useOrgPeople()
  const members = useDeliveryTeamMembers()
  const sales = useSalesPersons()
  const employees = useMemo(
    () => buildMasterEmployees(org.data ?? [], members.data ?? [], sales.data ?? []),
    [org.data, members.data, sales.data],
  )
  return { employees, orgPeople: org.data ?? NONE, isLoading: org.isLoading }
}
