import { compatibleCharts, NO_PERIOD, recommendChart, type DataRow, type DatasetDef } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { chooseChart, patchSpec, type Draft } from './draft'
import { CHART_LABEL } from './labels'

export interface Details { name: string; description: string; shared: boolean }

/** Step 3: chart (recommended first, with the reason), how report periods apply, and the name. */
export function ChartStep({ dataset, draft, rows, details, onChange, onDetails }: {
  dataset: DatasetDef; draft: Draft; rows?: readonly DataRow[]; details: Details; onChange: (d: Draft) => void; onDetails: (d: Details) => void
}) {
  const distinct = (key: string) => new Set((rows ?? []).map((r) => r[key])).size || 50
  const rec = recommendChart(draft.spec.query, rows ? distinct : undefined)
  const options = compatibleCharts(draft.spec.query)
  const dates = dataset.fields.filter((f) => f.type === 'date')
  return (
    <div className="studio-panel" aria-label="Chart and details">
      <h2>Chart</h2>
      <div className="studio-hint" role="note"><Icon name="Lightbulb" size={14} /><span><strong>Recommended: {CHART_LABEL[rec.chart]}.</strong> {rec.reason}</span></div>
      <div className="studio-chart-choices" role="group" aria-label="Chart type">
        {options.map((c) => (
          <button key={c} type="button" aria-pressed={draft.spec.chart === c} onClick={() => onChange(chooseChart(draft, c))}>
            {CHART_LABEL[c]}{c === rec.chart ? ' ★' : ''}
          </button>
        ))}
      </div>
      {draft.spec.chart === 'kpi' && (
        <label className="studio-row"><input type="checkbox" checked={draft.spec.compare !== false} onChange={(e) => onChange(patchSpec(draft, { compare: e.target.checked }))} /> Show change vs the previous period (in reports)</label>
      )}
      {dates.length > 0 && (
        <label className="studio-field">
          <span>Report period applies to</span>
          <select className="studio-select" value={draft.spec.periodField ?? ''} onChange={(e) => onChange(patchSpec(draft, { periodField: e.target.value || undefined }))}>
            <option value="">{dates.find((d) => d.key === dataset.timeField)?.label ?? 'Default date'} (default)</option>
            {dates.filter((d) => d.key !== dataset.timeField).map((d) => <option key={d.key} value={d.key}>{d.label}</option>)}
            <option value={NO_PERIOD}>Ignore the report period (always current)</option>
          </select>
        </label>
      )}
      <h2>Details</h2>
      <label className="studio-field"><span>Name</span><input className="studio-input" aria-label="Visual name" maxLength={120} value={details.name} onChange={(e) => onDetails({ ...details, name: e.target.value })} /></label>
      <label className="studio-field"><span>Description</span><textarea className="studio-textarea" aria-label="Visual description" maxLength={1000} rows={2} value={details.description} onChange={(e) => onDetails({ ...details, description: e.target.value })} /></label>
      <label className="studio-row"><input type="checkbox" checked={details.shared} onChange={(e) => onDetails({ ...details, shared: e.target.checked })} /> Share with my team (visible to everyone with Insights access)</label>
    </div>
  )
}
