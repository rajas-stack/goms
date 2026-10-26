import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { PeopleColumnConfig } from '@goms/domain'
import { repository } from '@/data/repository'

const KEY = ['peopleColumnConfigs'] as const

/** Manage columns › People columns: each person column's setup, by column id. */
export function usePeopleColumnConfigs() {
  return useQuery({ queryKey: KEY, queryFn: () => repository.listPeopleColumnConfigs() })
}

export function useSetPeopleColumnConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ columnId, config }: { columnId: string; config: PeopleColumnConfig | null }) => repository.setPeopleColumnConfig(columnId, config),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  })
}
