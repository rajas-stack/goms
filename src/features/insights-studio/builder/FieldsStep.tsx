import {
  COUNT_FIELD, COUNT_FIELD_DEF, TIME_GRAINS, aggregationsFor, getField, type Aggregation, type DataRow, type DatasetDef, type TimeGrain,
  type VisualSuggestion,
} from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { addMeasure, removeMeasure, setDimension, setFilters, setGrain, setMeasureAgg, setMeasureField, patchSpec, type Draft } from './draft'
import { FilterEditor } from './FilterEditor'
import { AGG_LABEL, GRAIN_LABEL } from './labels'

/** Step 2: fields — ONLY the chosen source's fields are offered (lineage). */
export function FieldsStep({ dataset, draft, rows, onChange, onSuggestion }: {
  dataset: DatasetDef; draft: Draft; rows?: readonly DataRow[]; onChange: (d: Draft) => void; onSuggestion: (s: VisualSuggestion) => void
}) {
  const { query } = draft.spec
  const dims = dataset.fields.filter((f) => f.role === 'dimension')
  const measureFields = [COUNT_FIELD_DEF, ...dataset.fields.filter((f) => f.role === 'measure'), ...dataset.fields.filter((f) => f.role === 'dimension')]
  const dimSlots = Math.min(query.dimensions.length + 1, 2)
  return (
    <div className="studio-panel" aria-label="Fields">
      <h2>Fields from {dataset.label}</h2>
      {(dataset.suggestions?.length ?? 0) > 0 && (
        <div className="studio-field">
          <span>Suggested for this source</span>
          <div className="studio-chart-choices">
            {dataset.suggestions!.map((s) => <button key={s.name} type="button" title={s.description} onClick={() => onSuggestion(s)}><Icon name="Sparkles" size={12} /> {s.name}</button>)}
          </div>
        </div>
      )}
      {Array.from({ length: dimSlots }, (_, i) => {
        const current = query.dimensions[i]
        const def = current ? getField(dataset, current.field) : undefined
        return (
          <div key={i} className="studio-field">
            <span>{i === 0 ? 'Group by' : 'Then split by'}</span>
            <div className="studio-row">
              <select className="studio-select" aria-label={i === 0 ? 'Group by' : 'Split by'} value={current?.field ?? ''} onChange={(e) => onChange(setDimension(draft, i, e.target.value, rows))}>
                <option value="">{i === 0 ? 'Nothing (one total)' : 'No split'}</option>
                {dims.map((f) => <option key={f.key} value={f.key} disabled={query.dimensions.some((d, j) => j !== i && d.field === f.key)}>{f.label}</option>)}
              </select>
              {def?.type === 'date' && (
                <select className="studio-select" aria-label="Time grain" value={current?.grain ?? 'month'} onChange={(e) => onChange(setGrain(draft, i, e.target.value as TimeGrain, rows))}>
                  {TIME_GRAINS.map((g) => <option key={g} value={g}>{GRAIN_LABEL[g]}</option>)}
                </select>
              )}
            </div>
          </div>
        )
      })}
      {query.dimensions.some((d) => d.grain === 'quarter' || d.grain === 'half' || d.grain === 'year') && (
        <label className="studio-field">
          <span>Year runs</span>
          <select className="studio-select" aria-label="Calendar" value={query.calendar ?? 'fy'} onChange={(e) => onChange(patchSpec(draft, { query: { ...query, calendar: e.target.value as 'fy' | 'calendar' } }))}>
            <option value="fy">Financial year (Apr–Mar)</option>
            <option value="calendar">Calendar year (Jan–Dec)</option>
          </select>
        </label>
      )}
      <div className="studio-field">
        <span>Measures</span>
        {query.measures.map((m, i) => {
          const def = getField(dataset, m.field) ?? COUNT_FIELD_DEF
          return (
            <div key={i} className="studio-row" role="group" aria-label={`Measure ${i + 1}`}>
              <select className="studio-select" aria-label="Measure field" value={m.field} onChange={(e) => onChange(setMeasureField(draft, i, e.target.value, rows))}>
                {measureFields.map((f) => <option key={f.key} value={f.key}>{f.label}</option>)}
              </select>
              {m.field !== COUNT_FIELD && (
                <select className="studio-select" aria-label="Aggregation" value={m.agg} onChange={(e) => onChange(setMeasureAgg(draft, i, e.target.value as Aggregation, rows))}>
                  {aggregationsFor(def).map((a) => <option key={a} value={a}>{AGG_LABEL[a]}</option>)}
                </select>
              )}
              <button type="button" className="studio-icon-btn" aria-label={`Remove measure ${i + 1}`} disabled={query.measures.length <= 1} onClick={() => onChange(removeMeasure(draft, i, rows))}><Icon name="X" size={14} /></button>
            </div>
          )
        })}
        <button type="button" className="studio-btn" disabled={query.measures.length >= 4} onClick={() => onChange(addMeasure(draft, rows))}><Icon name="Plus" size={14} />Add measure</button>
      </div>
      <FilterEditor dataset={dataset} filters={query.filters} rows={rows} onChange={(f) => onChange(setFilters(draft, f))} />
    </div>
  )
}
