import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository, type SetRoleOverrideInput } from '@/data/repository'

export const useAccessReadiness = () => useQuery({ queryKey: ['accessReadiness'], queryFn: () => repository.getAccessReadiness() })
export const useRoleOverrides = () => useQuery({ queryKey: ['roleOverrides'], queryFn: () => repository.listRoleOverrides() })

/** An override changes who can do what at once, so the readiness view, the override list and the caller's own access refresh. */
export function useRoleOverrideMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['accessReadiness'] })
    qc.invalidateQueries({ queryKey: ['roleOverrides'] })
    qc.invalidateQueries({ queryKey: ['myAccess'] })
  }
  const set = useMutation({ mutationFn: (input: SetRoleOverrideInput) => repository.setRoleOverride(input), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.removeRoleOverride(id), onSuccess: invalidate })
  return { set, remove }
}
