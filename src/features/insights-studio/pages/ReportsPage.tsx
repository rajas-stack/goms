import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { periodLabel, type InsightReport } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { errorText, useCanEditItem, useReportLibrary, useStudioMutations } from '../api'
import { STUDIO_PATHS } from '../paths'
import { StudioShell } from '../StudioShell'

/** Built-in templates and saved reports. */
export function ReportsPage() {
  const navigate = useNavigate()
  const { reports, isLoading, isError } = useReportLibrary()
  const canEdit = useCanEditItem()
  const { createReport, deleteReport } = useStudioMutations()
  const [removing, setRemoving] = useState<InsightReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const copy = async (r: InsightReport, name: string) => {
    setError(null)
    try {
      const created = await createReport.mutateAsync({ name: name.slice(0, 120), description: r.description, widgets: r.widgets, filters: r.filters, shared: false })
      navigate(STUDIO_PATHS.report(created.id))
    } catch (e) { setError(errorText(e)) }
  }
  const blank = () => copy({ id: '', name: 'Untitled report', description: '', widgets: [], filters: { period: { kind: 'all' }, calendar: 'fy' }, ownerEmail: '', shared: false, createdAt: '', updatedAt: '' }, 'Untitled report')
  const templates = reports.filter((r) => r.builtIn), saved = reports.filter((r) => !r.builtIn)
  const card = (r: InsightReport) => (
    <article key={r.id} className="studio-card" aria-label={r.name}>
      <h3>{r.name}</h3>
      {r.description && <p>{r.description}</p>}
      <div className="studio-meta">
        <span className="studio-chip studio-chip-accent">{periodLabel(r.filters.period, r.filters.calendar)}</span>
        <span className="studio-chip">{r.widgets.filter((w) => w.kind === 'visual').length} visuals</span>
        {r.builtIn ? <span className="studio-chip">Template</span> : <span className="studio-chip">{r.shared ? 'Shared' : 'Personal'}</span>}
      </div>
      <div className="studio-card-actions">
        <Link className="studio-btn studio-btn-primary" to={STUDIO_PATHS.report(r.id)}><Icon name="Eye" size={14} />Open</Link>
        <button type="button" className="studio-btn" disabled={createReport.isPending} onClick={() => void copy(r, r.builtIn ? r.name : `${r.name} (copy)`)}>
          <Icon name="Copy" size={14} />{r.builtIn ? 'Save as my report' : 'Duplicate'}
        </button>
        {canEdit(r) && <button type="button" className="studio-btn studio-btn-danger" onClick={() => setRemoving(r)}><Icon name="Trash2" size={14} />Delete</button>}
      </div>
    </article>
  )
  return (
    <StudioShell title="Templates / Reports" actions={<button type="button" className="studio-btn studio-btn-primary" disabled={createReport.isPending} onClick={() => void blank()}><Icon name="Plus" />New report</button>}>
      {error && <div role="alert" className="studio-error">{error}</div>}
      <h2 className="studio-section-title">Templates</h2>
      <div className="studio-grid-cards">{templates.map(card)}</div>
      <h2 className="studio-section-title">My & shared reports</h2>
      {isError && <div role="alert" className="studio-error">Saved reports could not be loaded.</div>}
      {isLoading ? <div className="studio-empty" role="status">Loading…</div> : saved.length ? <div className="studio-grid-cards">{saved.map(card)}</div>
        : <div className="studio-empty">No saved reports yet. Open a template and “Save as my report”, or start a new one.</div>}
      <ConfirmDeleteDialog open={!!removing} onClose={() => setRemoving(null)} itemLabel={removing?.name ?? ''}
        onConfirm={async () => { if (removing) await deleteReport.mutateAsync(removing.id) }} />
    </StudioShell>
  )
}
