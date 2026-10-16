import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getDataset, readableDatasets, type DataRow, type DatasetDef } from '@goms/domain'
import { repository, isoToday } from '@/data/repository'
import { usePermissions } from '@/lib/permissions'
import { DATASET_FETCHERS } from './fetchers'

export const STUDIO_KEY = ['insightsStudio'] as const

/** The rows of one data source (cached a minute; every visual on that source shares them). */
export function useDatasetRows(datasetId: string | undefined) {
  return useQuery({
    queryKey: [...STUDIO_KEY, 'rows', datasetId ?? ''],
    queryFn: async (): Promise<DataRow[]> => {
      const fetcher = datasetId ? DATASET_FETCHERS[datasetId] : undefined
      if (!fetcher) throw new Error(`No reader for data source "${datasetId}".`)
      return fetcher(repository)
    },
    enabled: !!datasetId && !!DATASET_FETCHERS[datasetId],
    staleTime: 60_000,
  })
}

/** Data sources this user may read (RBAC off or local mode: all of them). */
export function useReadableDatasets(): DatasetDef[] {
  const p = usePermissions()
  return useMemo(() => readableDatasets((m) => !p.enforced || p.level(m) !== 'N'), [p])
}

/** True when the user may read this source. */
export function useCanReadDataset(datasetId: string | undefined): boolean {
  const readable = useReadableDatasets()
  return !!datasetId && !!getDataset(datasetId) && readable.some((d) => d.id === datasetId)
}

/** Today as `YYYY-MM-DD` (local), for derived fields and default periods. */
export function useToday(): string {
  return useMemo(() => isoToday(), [])
}
