import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { repository, type SetRoleOverrideInput } from '@/data/repository'
import type { OverrideHistoryFilter } from '@/data/accessTypes'

/** A tRPC FORBIDDEN (the server refused the caller). Retrying a refusal only delays the message by seconds. */
export const isForbidden = (error: unknown): boolean => (error as { data?: { code?: string } } | null)?.data?.code === 'FORBIDDEN'
const retryUnlessForbidden = (failures: number, error: Error) => !isForbidden(error) && failures < 1

export const useAccessReadiness = () =>
  useQuery({ queryKey: ['accessReadiness'], queryFn: () => repository.getAccessReadiness(), retry: retryUnlessForbidden })
export const useRoleOverrides = () => useQuery({ queryKey: ['roleOverrides'], queryFn: () => repository.listRoleOverrides() })
/** Overrides that match no person row: invisible in the people table, so they get their own list. */
export const useUnmatchedOverrides = () =>
  useQuery({ queryKey: ['unmatchedOverrides'], queryFn: () => repository.listUnmatchedOverrides(), retry: retryUnlessForbidden })
/** Newest first; `filter` narrows it to one person (email) and / or role. */
export const useOverrideHistory = (filter: OverrideHistoryFilter = {}) =>
  useQuery({ queryKey: ['overrideHistory', filter.email ?? '', filter.role ?? ''], queryFn: () => repository.listOverrideHistory(filter), retry: retryUnlessForbidden })
export const usePermissionMatrix = () =>
  useQuery({ queryKey: ['permissionMatrix'], queryFn: () => repository.getPermissionMatrix(), staleTime: 5 * 60_000, retry: retryUnlessForbidden })
/** The server's answer for one person (never computed in the browser). Disabled until there is an email to ask about. */
export const useEffectivePermissions = (email: string | null) =>
  useQuery({ queryKey: ['effectivePermissions', email], queryFn: () => repository.getEffectivePermissions(email!), enabled: !!email, retry: retryUnlessForbidden })

/** An override changes who can do what at once, so the readiness view, the override lists, the history, everyone's effective
 *  permissions and the caller's own access refresh. */
export function useRoleOverrideMutations() {
  const qc = useQueryClient()
  const invalidate = () => {
    for (const key of ['accessReadiness', 'roleOverrides', 'unmatchedOverrides', 'overrideHistory', 'effectivePermissions', 'myAccess']) {
      qc.invalidateQueries({ queryKey: [key] })
    }
  }
  const set = useMutation({ mutationFn: (input: SetRoleOverrideInput) => repository.setRoleOverride(input), onSuccess: invalidate })
  const remove = useMutation({ mutationFn: (id: string) => repository.removeRoleOverride(id), onSuccess: invalidate })
  return { set, remove }
}
