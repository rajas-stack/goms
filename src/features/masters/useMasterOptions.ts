import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { repository } from '@/data/repository'
import { useAmnexDepartments } from '@/features/departments/api'
import { useMasters } from '@/modules/commercial-calculator/api'

/** Every reference list (master) lives in Settings > Masters and is maintained there only.
 *  Features that pick from a master read its options through these hooks — never a hard-coded
 *  array — so adding, renaming or deleting a master entry shows up everywhere at once. */

/** Settings > Masters > Verticals: active vertical names in display order. */
export function useVerticalNames(): string[] {
  const { data = [] } = useMasters('verticals')
  return useMemo(
    () => [...data].filter((v) => v.active).sort((a, b) => a.displayOrder - b.displayOrder || a.name.localeCompare(b.name)).map((v) => v.name),
    [data],
  )
}

export function useEmployeeDepartmentOptions() { return useAmnexDepartments() }
export function useClientDepartmentOptions(enabled = true) {
  return useQuery({ queryKey: ['departments'], queryFn: () => repository.listDepartments(), enabled })
}
