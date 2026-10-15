import { useMemo } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import {
  COUNT_FIELD, datasetsByModule, recommendChart, runQuery, type DataRow, type DatasetDef, type QuerySpec,
} from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { ChartView } from '../charts/ChartView'
import { useDatasetRows, useReadableDatasets, useToday } from '../data/hooks'
import { newVisualFrom } from '../paths'
import { StudioShell } from '../StudioShell'
import { FIELD_TYPE_LABEL } from '../builder/labels'

/** Every data source the user can read: where it comes from, its fields, a live row count and quick breakdowns. */
export function DataSourcesPage() {
  const datasets = useReadableDatasets()
  const [params, setParams] = useSearchParams()
  const selected = datasets.find((d) => d.id === params.get('source')) ?? datasets[0]
  return (
    <StudioShell title="Data sources">
      {!datasets.length ? <div className="studio-empty">You do not have access to any data source.</div> : (
        <div className="studio-builder">
          <nav aria-label="Data sources" className="studio-panel">
            {datasetsByModule(datasets).map((group) => (
              <section key={group.module} aria-label={group.module}>
                <h2 className="studio-section-title">{group.module}</h2>
                <div className="studio-picker-list">
                  {group.datasets.map((d) => (
                    <button key={d.id} type="button" aria-pressed={d.id === selected?.id} className="studio-source" onClick={() => setParams({ source: d.id }, { replace: true })}>
                      <strong>{d.label}</strong>
                      <div className="studio-meta"><span className="studio-chip">{d.fields.length} fields</span></div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </nav>
          {selected && <SourceDetail key={selected.id} dataset={selected} />}
        </div>
      )}
    </StudioShell>
  )
}

function SourceDetail({ dataset }: { dataset: DatasetDef }) {
  const rows = useDatasetRows(dataset.id)
  return (
    <section className="studio-panel" aria-label={dataset.label}>
      <div className="studio-row">
        <h2 style={{ marginRight: 'auto' }}>{dataset.label}</h2>
        <Link className="studio-btn studio-btn-primary" to={newVisualFrom(dataset.id)}><Icon name="Plus" />Create visual from this source</Link>
      </div>
      <p>{dataset.description}</p>
      <div className="studio-meta">
        <span className="studio-chip studio-chip-accent">{dataset.module}</span>
        <span className="studio-chip" aria-live="polite">
          {rows.isLoading ? 'Counting records…' : rows.isError ? 'Records could not be loaded' : `${rows.data?.length ?? 0} ${dataset.rowNoun} records`}
        </span>
        {dataset.timeField && <span className="studio-chip">Dated by {dataset.fields.find((f) => f.key === dataset.timeField)?.label}</span>}
      </div>
      {rows.data && <Breakdowns dataset={dataset} rows={rows.data} />}
      <h3 className="studio-section-title">Fields</h3>
      <div className="studio-table-wrap">
        <table className="studio-ds-fields">
          <thead><tr><th scope="col">Field</th><th scope="col">Type</th><th scope="col">Role</th><th scope="col">Notes</th></tr></thead>
          <tbody>
            {dataset.fields.map((f) => (
              <tr key={f.key}>
                <td>{f.label}</td><td>{FIELD_TYPE_LABEL[f.type]}</td><td>{f.role === 'measure' ? 'Measure' : 'Dimension'}</td>
                <td>{[f.derive ? 'Derived' : '', f.description ?? '', f.enumValues ? f.enumValues.map((o) => o.label).join(', ') : ''].filter(Boolean).join(' · ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Breakdowns({ dataset, rows }: { dataset: DatasetDef; rows: readonly DataRow[] }) {
  const today = useToday()
  const charts = useMemo(() => dataset.fields.filter((f) => f.breakdown).slice(0, 6).map((f) => {
    const query: QuerySpec = { datasetId: dataset.id, dimensions: [{ field: f.key }], measures: [{ field: COUNT_FIELD, agg: 'count' }], filters: [], limit: 12 }
    const result = runQuery(rows, query, { today })
    return { field: f, result, chart: recommendChart(query, () => result.groups).chart }
  }), [dataset, rows, today])
  if (!charts.length) return null
  return (
    <>
      <h3 className="studio-section-title">Quick breakdowns</h3>
      <div className="studio-ds-breakdowns">
        {charts.map(({ field, result, chart }) => (
          <figure key={field.key} className="studio-card" aria-label={`${dataset.label} by ${field.label}`}>
            <figcaption><strong>By {field.label.toLowerCase()}</strong></figcaption>
            <ChartView chart={chart} result={result} title={`${dataset.label} by ${field.label}`} />
          </figure>
        ))}
      </div>
    </>
  )
}
