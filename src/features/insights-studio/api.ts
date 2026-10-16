import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BUILT_IN_VISUALS, builtInReports, type InsightReport, type InsightReportInput, type InsightVisual, type InsightVisualInput,
} from '@goms/domain'
import { repository } from '@/data/repository'
import { useMyAccess } from '@/lib/api'
import { usePermissions } from '@/lib/permissions'
import { LOCAL_STUDIO_OWNER } from '@/data/in-memory/insightsStudio'
import { STUDIO_KEY, useToday } from './data/hooks'

const VISUALS_KEY = [...STUDIO_KEY, 'visuals'] as const
const REPORTS_KEY = [...STUDIO_KEY, 'reports'] as const

/** Built-in visuals first, then the user's own and shared ones. */
export function useVisualLibrary() {
  const query = useQuery({ queryKey: VISUALS_KEY, queryFn: () => repository.listInsightVisuals() })
  const visuals = useMemo<InsightVisual[]>(() => [...BUILT_IN_VISUALS, ...(query.data ?? [])], [query.data])
  return { ...query, visuals }
}

/** Built-in templates (dated to today's FY) first, then saved reports. */
export function useReportLibrary() {
  const today = useToday()
  const query = useQuery({ queryKey: REPORTS_KEY, queryFn: () => repository.listInsightReports() })
  const reports = useMemo<InsightReport[]>(() => [...builtInReports(today), ...(query.data ?? [])], [query.data, today])
  return { ...query, reports }
}

export function useStudioMutations() {
  const qc = useQueryClient()
  const visuals = () => qc.invalidateQueries({ queryKey: VISUALS_KEY })
  const reports = () => qc.invalidateQueries({ queryKey: REPORTS_KEY })
  return {
    createVisual: useMutation({ mutationFn: (input: InsightVisualInput) => repository.createInsightVisual(input), onSuccess: visuals }),
    updateVisual: useMutation({ mutationFn: ({ id, ...input }: InsightVisualInput & { id: string }) => repository.updateInsightVisual(id, input), onSuccess: visuals }),
    deleteVisual: useMutation({ mutationFn: (id: string) => repository.deleteInsightVisual(id), onSuccess: visuals }),
    createReport: useMutation({ mutationFn: (input: InsightReportInput) => repository.createInsightReport(input), onSuccess: reports }),
    updateReport: useMutation({ mutationFn: ({ id, ...input }: InsightReportInput & { id: string }) => repository.updateInsightReport(id, input), onSuccess: reports }),
    deleteReport: useMutation({ mutationFn: (id: string) => repository.deleteInsightReport(id), onSuccess: reports }),
  }
}

/** UX only (the server decides): built-ins are read-only; otherwise the owner, or a Role & Access manager for shared items. */
export function useCanEditItem(): (item: { builtIn?: boolean; ownerEmail: string; shared: boolean }) => boolean {
  const me = useMyAccess().data?.email?.toLowerCase() ?? null
  const p = usePermissions()
  return (item) => {
    if (item.builtIn) return false
    if (item.ownerEmail === LOCAL_STUDIO_OWNER || !me || item.ownerEmail.toLowerCase() === me) return true
    return item.shared && (!!p.systemAdmin || p.level('admin.access') === 'W')
  }
}

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : 'Something went wrong. Please retry.')
