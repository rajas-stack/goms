import { useMemo } from 'react'
import { effectiveQuery, getDataset, previousQuery, runQuery, type QueryResult, type ReportFilters, type VisualSpec } from '@goms/domain'
import { ChartView } from './charts/ChartView'
import { useCanReadDataset, useDatasetRows, useToday } from './data/hooks'

interface Computed { result: QueryResult; previous: QueryResult | null; error: null }
interface Failed { result: null; previous: null; error: string }

/** Runs a visual's query (with any report-level filters) on its own source's rows and draws it. */
export function useVisualResult(spec: VisualSpec | null, filters?: ReportFilters): { state: Computed | Failed | null; isLoading: boolean; isError: boolean; rows: number } {
  const today = useToday()
  const rows = useDatasetRows(spec?.query.datasetId)
  const state = useMemo<Computed | Failed | null>(() => {
    if (!spec || !rows.data) return null
    try {
      const current = effectiveQuery(spec, filters)
      const before = spec.chart === 'kpi' && spec.compare !== false ? previousQuery(spec, filters) : null
      return {
        result: runQuery(rows.data, current.query, { today }),
        previous: before ? runQuery(rows.data, before, { today }) : null,
        error: null,
      }
    } catch (error) {
      return { result: null, previous: null, error: error instanceof Error ? error.message : 'This visual could not be computed.' }
    }
  }, [spec, filters, rows.data, today])
  return { state, isLoading: rows.isLoading, isError: rows.isError, rows: rows.data?.length ?? 0 }
}

export function VisualPanel({ spec, filters, title }: { spec: VisualSpec; filters?: ReportFilters; title: string }) {
  const canRead = useCanReadDataset(spec.query.datasetId)
  const { state, isLoading, isError } = useVisualResult(canRead ? spec : null, filters)
  const source = getDataset(spec.query.datasetId)
  if (!canRead) return <div className="studio-empty" role="note">You do not have access to {source?.label ?? 'this data source'}.</div>
  if (isLoading) return <div className="studio-empty" role="status">Loading…</div>
  if (isError) return <div className="studio-empty" role="alert">{source?.label ?? 'The data'} could not be loaded.</div>
  if (!state) return null
  if (state.error !== null) return <div className="studio-empty" role="alert">{state.error}</div>
  return <ChartView chart={spec.chart} result={state.result} previous={state.previous} title={title} />
}
