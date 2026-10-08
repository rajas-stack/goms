import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { TenderWebsiteInput, TenderWebsiteKind } from '@goms/domain'
import { repository } from '@/data/repository'

/** Prefix shared by every website list; each kind is cached under its own key. */
export const TENDER_WEBSITES_KEY = ['tenderWebsites'] as const

const websitesKey = (kind: TenderWebsiteKind) => [...TENDER_WEBSITES_KEY, kind] as const

/** Websites on one Settings page. Defaults to tender portals, which is what a
 *  bid's General tab offers — verification sites never appear there. */
export function useTenderWebsites(kind: TenderWebsiteKind = 'tender') {
  return useQuery({ queryKey: websitesKey(kind), queryFn: () => repository.listTenderWebsites(kind) })
}

export function useTenderDscEmployees() {
  return useQuery({ queryKey: ['orgPeople', 'tenderDsc'], queryFn: () => repository.listTenderDscEmployees() })
}

/** Create / update / delete, each refreshing the lists on success. New
 *  websites are created on the given kind's page. */
export function useTenderWebsiteMutations(kind: TenderWebsiteKind = 'tender') {
  const queryClient = useQueryClient()
  const onSuccess = () => queryClient.invalidateQueries({ queryKey: TENDER_WEBSITES_KEY })
  return {
    create: useMutation({ mutationFn: (input: TenderWebsiteInput) => repository.createTenderWebsite({ ...input, kind }), onSuccess }),
    update: useMutation({ mutationFn: ({ id, ...input }: TenderWebsiteInput & { id: string }) => repository.updateTenderWebsite(id, input), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => repository.deleteTenderWebsite(id), onSuccess }),
    editLock: useMutation({ mutationFn: ({ id, locked }: { id: string; locked: boolean }) => repository.setTenderWebsiteEditingLock(id, locked), onSuccess }),
  }
}
