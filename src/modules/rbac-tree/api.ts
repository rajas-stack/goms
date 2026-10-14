import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { ApplyTemplateInput, RbacLinkableRef, RbacGrantChange, RbacRoleInput, RbacSubjectRef, RbacTemplateInput } from '@goms/domain'
import { repository } from '@/data/repository'
import { RBAC_MY_ACCESS_KEY } from '@/lib/rbacTree/access'

const ROOT = ['rbacTree'] as const
export const RBAC_KEYS = {
  nodes: [...ROOT, 'nodes'] as const,
  subjects: [...ROOT, 'subjects'] as const,
  config: (s: RbacSubjectRef | null) => [...ROOT, 'config', s?.type ?? null, s?.id ?? null] as const,
}

export const useRbacNodes = () => useQuery({ queryKey: RBAC_KEYS.nodes, queryFn: () => repository.listRbacNodes() })
export const useRbacSubjects = () => useQuery({ queryKey: RBAC_KEYS.subjects, queryFn: () => repository.getRbacSubjects(), retry: false })
export const useRbacConfig = (subject: RbacSubjectRef | null) => useQuery({
  queryKey: RBAC_KEYS.config(subject), queryFn: () => repository.getRbacConfig(subject!), enabled: !!subject,
})
/** A template's grants, for showing what a linked subject inherits. */
export const useTemplateGrants = (templateId: string | null) => useRbacConfig(templateId ? { type: 'template', id: templateId } : null)

/** Every write refreshes the whole tree area, including the signed-in user's own resolved access. */
export function useRbacMutations() {
  const qc = useQueryClient()
  const onSuccess = () => Promise.all([
    qc.invalidateQueries({ queryKey: ROOT }), qc.invalidateQueries({ queryKey: RBAC_MY_ACCESS_KEY }),
  ])
  return {
    sync: useMutation({ mutationFn: () => repository.syncRbacNodes(), onSuccess }),
    setConfig: useMutation({ mutationFn: ({ subject, changes }: { subject: RbacSubjectRef; changes: RbacGrantChange[] }) => repository.setRbacConfig(subject, changes), onSuccess }),
    createRole: useMutation({ mutationFn: (input: RbacRoleInput) => repository.createRbacRole(input), onSuccess }),
    updateRole: useMutation({ mutationFn: ({ id, ...input }: RbacRoleInput & { id: string }) => repository.updateRbacRole(id, input), onSuccess }),
    deleteRole: useMutation({ mutationFn: (id: string) => repository.deleteRbacRole(id), onSuccess }),
    createTemplate: useMutation({ mutationFn: (input: RbacTemplateInput) => repository.createRbacTemplate(input), onSuccess }),
    updateTemplate: useMutation({ mutationFn: ({ id, ...input }: { id: string; name: string; description?: string }) => repository.updateRbacTemplate(id, input), onSuccess }),
    duplicateTemplate: useMutation({ mutationFn: (id: string) => repository.duplicateRbacTemplate(id), onSuccess }),
    deleteTemplate: useMutation({ mutationFn: (id: string) => repository.deleteRbacTemplate(id), onSuccess }),
    applyTemplate: useMutation({ mutationFn: (input: ApplyTemplateInput) => repository.applyRbacTemplate(input), onSuccess }),
    unlinkTemplate: useMutation({ mutationFn: (subject: RbacLinkableRef) => repository.unlinkRbacTemplate(subject), onSuccess }),
  }
}

export const errorText = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback)
