import { useMemo, useState } from 'react'
import { getDataset, type InsightVisual } from '@goms/domain'
import { Dialog } from '@/components/ui/Dialog'
import { CHART_LABEL } from '../builder/labels'

/** Pick a visual from the library to place on the report (filterable by name and source). */
export function WidgetPicker({ open, visuals, onPick, onClose }: { open: boolean; visuals: InsightVisual[]; onPick: (v: InsightVisual) => void; onClose: () => void }) {
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const sources = useMemo(() => [...new Set(visuals.map((v) => v.spec.query.datasetId))], [visuals])
  const shown = visuals
    .filter((v) => !source || v.spec.query.datasetId === source)
    .filter((v) => !search.trim() || `${v.name} ${v.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  return (
    <Dialog open={open} onClose={onClose} title="Add a visual" description="Choose from your library. Build new ones under Visualization components.">
      <div className="studio" style={{ height: 'auto', background: 'transparent' }}>
        <div className="studio-toolbar">
          <input type="search" aria-label="Search the library" placeholder="Search…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <select className="studio-select" aria-label="Library source" value={source} onChange={(e) => setSource(e.target.value)}>
            <option value="">All sources</option>
            {sources.map((id) => <option key={id} value={id}>{getDataset(id)?.label ?? id}</option>)}
          </select>
        </div>
        <div className="studio-picker-list" role="list">
          {shown.map((v) => (
            <button key={v.id} type="button" role="listitem" onClick={() => onPick(v)} aria-label={`Add ${v.name}`}>
              <strong>{v.name}</strong>
              <div className="studio-meta"><span className="studio-chip studio-chip-accent">{getDataset(v.spec.query.datasetId)?.label}</span><span className="studio-chip">{CHART_LABEL[v.spec.chart]}</span></div>
            </button>
          ))}
          {!shown.length && <div className="studio-empty">No visual matches.</div>}
        </div>
      </div>
    </Dialog>
  )
}

/** Edit a widget's title override, or a heading's text. */
export function WidgetTextDialog({ open, kind, value, onSave, onClose }: { open: boolean; kind: 'visual' | 'text'; value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value)
  return (
    <Dialog open={open} onClose={onClose} title={kind === 'text' ? 'Edit section heading' : 'Rename widget'}
      footer={<><button type="button" className="studio-btn" onClick={onClose}>Cancel</button><button type="button" className="studio-btn studio-btn-primary" onClick={() => onSave(text)}>Save</button></>}>
      <div className="studio" style={{ height: 'auto', background: 'transparent' }}>
        {kind === 'text'
          ? <label className="studio-field"><span>Heading (a second line adds a note)</span><textarea className="studio-textarea" aria-label="Heading text" rows={3} maxLength={2000} value={text} onChange={(e) => setText(e.target.value)} /></label>
          : <label className="studio-field"><span>Title (leave empty to use the visual’s name)</span><input className="studio-input" aria-label="Widget title" maxLength={120} value={text} onChange={(e) => setText(e.target.value)} /></label>}
      </div>
    </Dialog>
  )
}
