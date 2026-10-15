import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { CompetitorInput } from '@goms/domain'
import { repository } from '@/data/repository'

export const COMPETITORS_KEY = ['competitors'] as const

export function useCompetitors() {
  return useQuery({ queryKey: COMPETITORS_KEY, queryFn: () => repository.listCompetitors() })
}

/** Create / update / delete, each refreshing the list on success. */
export function useCompetitorMutations() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: COMPETITORS_KEY })
  return {
    create: useMutation({ mutationFn: (input: CompetitorInput) => repository.createCompetitor(input), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...input }: CompetitorInput & { id: string }) => repository.updateCompetitor(id, input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => repository.deleteCompetitor(id), onSuccess }),
  }
}
