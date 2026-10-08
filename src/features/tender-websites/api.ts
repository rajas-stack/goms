import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TenderWebsiteInput } from '@goms/domain'
import { repository } from '@/data/repository'

export const TENDER_WEBSITES_KEY = ['tenderWebsites'] as const

export function useTenderWebsites() {
  return useQuery({ queryKey: TENDER_WEBSITES_KEY, queryFn: () => repository.listTenderWebsites() })
}

export function useTenderDscEmployees() {
  return useQuery({ queryKey: ['orgPeople', 'tenderDsc'], queryFn: () => repository.listTenderDscEmployees() })
}

/** Create / update / delete, each refreshing the shared list on success. */
export function useTenderWebsiteMutations() {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: TENDER_WEBSITES_KEY })
  return {
    create: useMutation({ mutationFn: (input: TenderWebsiteInput) => repository.createTenderWebsite(input), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...input }: TenderWebsiteInput & { id: string }) => repository.updateTenderWebsite(id, input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => repository.deleteTenderWebsite(id), onSuccess }),
  }
}
