import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository } from '@/data/repository'

export const AMNEX_DEPARTMENTS_KEY = ['amnexDepartments'] as const

export const useAmnexDepartments = () =>
  useQuery({ queryKey: AMNEX_DEPARTMENTS_KEY, queryFn: () => repository.listAmnexDepartments() })

/** Rename / delete rewrite employees' departments too, so the org (and the rosters derived from it) refresh as well. */
export function useAmnexDepartmentMutations() {
  const qc = useQueryClient()
  const onSuccess = () => Promise.all([
    qc.invalidateQueries({ queryKey: AMNEX_DEPARTMENTS_KEY }),
    qc.invalidateQueries({ queryKey: ['orgPeople'] }),
    qc.invalidateQueries({ queryKey: ['deliveryTeamMembers'] }),
  ])
  return {
    create: useMutation({ mutationFn: (name: string) => repository.createAmnexDepartment(name), onSuccess }),
    rename: useMutation({ mutationFn: ({ id, name }: { id: string; name: string }) => repository.renameAmnexDepartment(id, name), onSuccess }),
    reorder: useMutation({ mutationFn: (ids: string[]) => repository.reorderAmnexDepartments(ids), onSuccess }),
    remove: useMutation({ mutationFn: (id: string) => repository.deleteAmnexDepartment(id), onSuccess }),
  }
}
