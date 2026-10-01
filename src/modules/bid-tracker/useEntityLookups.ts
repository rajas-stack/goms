import { useMemo } from 'react'
import { useDepartments, useSalesPersons, useStates } from '@/lib/api'
import { buildLookups, type EntityLookups } from './gridColumns'

/** The records behind person / department / state columns, as pick-lists + name lookups. */
export function useEntityLookups(): EntityLookups {
  const { data: persons = [] } = useSalesPersons()
  const { data: departments = [] } = useDepartments()
  const { data: states = [] } = useStates()
  return useMemo(() => buildLookups({ persons, departments, states }), [persons, departments, states])
}
