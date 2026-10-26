import { useMemo } from 'react'
import type { PeopleColumnConfig } from '@goms/domain'
import { useCurrentPostings, useDeliveryTeamMembers, useDepartments, useOrgPeople, useSalesPersons, useStates } from '@/lib/api'
import type { SalesPosting } from '@/lib/types'
import { useMasters } from '@/modules/commercial-calculator/api'
import { buildLookups } from './gridColumns'
import { buildPeopleScope, employeeOptions, type PeopleLookups } from './peopleColumns'
import { usePeopleColumnConfigs } from './peopleColumnsApi'

/** The records behind person / department / state columns (and the masters `createMaster`
 *  columns pick from), as pick-lists + name lookups. */
export function useEntityLookups(): PeopleLookups {
  const { data: persons = [] } = useSalesPersons()
  const { data: departments = [] } = useDepartments()
  const { data: states = [] } = useStates()
  const { data: deliveryTeamMembers = [] } = useDeliveryTeamMembers()
  const { data: orgPeople = [] } = useOrgPeople()
  // A master row added anywhere invalidates these queries, so a new value shows up in the open grid at once.
  const { data: requirements = [] } = useMasters('requirements')
  const { data: bidProducts = [] } = useMasters('bidProducts')
  // People columns setup + sales territories: who each person column offers on a row (peopleColumns.ts).
  const { data: currentPostings = NO_POSTINGS } = useCurrentPostings()
  const { data: configs = NO_CONFIGS } = usePeopleColumnConfigs()
  return useMemo(() => ({
    ...buildLookups({ persons, deliveryTeamMembers, orgPeople, departments, states, masters: { requirements, bidProducts } }),
    employees: employeeOptions(orgPeople, persons),
    people: buildPeopleScope({ configs, salesPersons: persons, currentPostings, deliveryTeamMembers, orgPeople }),
  }), [persons, deliveryTeamMembers, orgPeople, departments, states, requirements, bidProducts, currentPostings, configs])
}

const NO_POSTINGS: Record<string, SalesPosting> = {}
const NO_CONFIGS: Record<string, PeopleColumnConfig> = {}
