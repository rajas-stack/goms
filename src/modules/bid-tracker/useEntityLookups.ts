import { useMemo } from 'react'
import { useDeliveryTeamMembers, useDepartments, useSalesPersons, useStates } from '@/lib/api'
import { buildLookups, type EntityLookups } from './gridColumns'

/** The records behind person / department / state columns, as pick-lists + name lookups. */
export function useEntityLookups(): EntityLookups {
  const { data: persons = [] } = useSalesPersons()
  const { data: departments = [] } = useDepartments()
  const { data: states = [] } = useStates()
  const { data: deliveryTeamMembers = [] } = useDeliveryTeamMembers()
  return useMemo(() => buildLookups({ persons, deliveryTeamMembers, departments, states }), [persons, deliveryTeamMembers, departments, states])
}
