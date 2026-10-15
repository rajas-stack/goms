import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { getDataset, type InsightVisual } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { errorText, useCanEditItem, useReportLibrary, useStudioMutations, useVisualLibrary } from '../api'
import { CHART_LABEL } from '../builder/labels'
import { useReadableDatasets } from '../data/hooks'
import { STUDIO_PATHS } from '../paths'
import { StudioShell } from '../StudioShell'

/** The visual library: built-in and saved visuals, searchable and filterable by source. */
export function VisualLibraryPage() {
  const { visuals, isLoading, isError } = useVisualLibrary()
  const { reports } = useReportLibrary()
  const readable = useReadableDatasets()
  const canEdit = useCanEditItem()
  const { createVisual, deleteVisual } = useStudioMutations()
  const [search, setSearch] = useState('')
  const [source, setSource] = useState('')
  const [removing, setRemoving] = useState<InsightVisual | null>(null)
  const [error, setError] = useState<string | null>(null)
  const usage = useMemo(() => {
    const count = new Map<string, number>()
    for (const r of reports) for (const id of new Set(r.widgets.map((w) => w.visualId).filter(Boolean))) count.set(id!, (count.get(id!) ?? 0) + 1)
    return count
  }, [reports])
  const readableIds = useMemo(() => new Set(readable.map((d) => d.id)), [readable])
  const shown = visuals.filter((v) => readableIds.has(v.spec.query.datasetId))
    .filter((v) => !source || v.spec.query.datasetId === source)
    .filter((v) => !search.trim() || `${v.name} ${v.description}`.toLowerCase().includes(search.trim().toLowerCase()))
  const duplicate = async (v: InsightVisual) => {
    setError(null)
    try { await createVisual.mutateAsync({ name: `${v.name} (copy)`.slice(0, 120), description: v.description, spec: v.spec, shared: false }) } catch (e) { setError(errorText(e)) }
  }
  return (
    <StudioShell title="Visualization components" actions={<Link to={STUDIO_PATHS.newVisual} className="studio-btn studio-btn-primary"><Icon name="Plus" />New visual</Link>}>
      <div className="studio-toolbar">
        <input type="search" aria-label="Search visuals" placeholder="Search visuals…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="studio-select" aria-label="Filter by data source" value={source} onChange={(e) => setSource(e.target.value)}>
          <option value="">All data sources</option>
          {readable.map((d) => <option key={d.id} value={d.id}>{d.label}</option>)}
        </select>
        <span className="studio-chip">{shown.length} visuals</span>
      </div>
      {error && <div role="alert" className="studio-error">{error}</div>}
      {isError && <div role="alert" className="studio-error">Saved visuals could not be loaded; showing built-ins only.</div>}
      {isLoading ? <div className="studio-empty" role="status">Loading…</div> : !shown.length ? <div className="studio-empty">No visuals match.</div> : (
        <div className="studio-grid-cards">
          {shown.map((v) => (
            <article key={v.id} className="studio-card" aria-label={v.name}>
              <h3>{v.name}</h3>
              {v.description && <p>{v.description}</p>}
              <div className="studio-meta">
                <span className="studio-chip studio-chip-accent">{getDataset(v.spec.query.datasetId)?.label}</span>
                <span className="studio-chip">{CHART_LABEL[v.spec.chart]}</span>
                {v.builtIn ? <span className="studio-chip">Built-in</span> : v.shared ? <span className="studio-chip">Shared</span> : <span className="studio-chip">Personal</span>}
                <span className="studio-chip">Used in {usage.get(v.id) ?? 0} reports</span>
              </div>
              <div className="studio-card-actions">
                <Link className="studio-btn" to={STUDIO_PATHS.visual(v.id)}><Icon name={canEdit(v) ? 'Pencil' : 'Eye'} size={14} />{canEdit(v) ? 'Edit' : 'Open'}</Link>
                <button type="button" className="studio-btn" onClick={() => void duplicate(v)} disabled={createVisual.isPending}><Icon name="Copy" size={14} />Duplicate</button>
                {canEdit(v) && <button type="button" className="studio-btn studio-btn-danger" onClick={() => setRemoving(v)}><Icon name="Trash2" size={14} />Delete</button>}
              </div>
            </article>
          ))}
        </div>
      )}
      <ConfirmDeleteDialog open={!!removing} onClose={() => setRemoving(null)} itemLabel={removing?.name ?? ''}
        onConfirm={async () => { if (removing) await deleteVisual.mutateAsync(removing.id) }} />
    </StudioShell>
  )
}
