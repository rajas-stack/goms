import { useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { InsightReport, InsightReportInput, InsightVisual } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { errorText, useCanEditItem, useReportLibrary, useStudioMutations, useVisualLibrary } from '../api'
import { useReadableDatasets } from '../data/hooks'
import { STUDIO_PATHS } from '../paths'
import { addWidget, defaultSize, patchWidget } from '../report/layout'
import { ReportCanvas } from '../report/ReportCanvas'
import { ReportFiltersBar } from '../report/ReportFiltersBar'
import { WidgetPicker, WidgetTextDialog } from '../report/WidgetPicker'
import { StudioShell } from '../StudioShell'

/** View or edit one report / template. Built-in templates are read-only seeds: "Save as my report" copies them. */
export function ReportPage() {
  const { id } = useParams()
  const { reports, isLoading } = useReportLibrary()
  const report = reports.find((r) => r.id === id)
  if (isLoading && !report) return <StudioShell title="Report"><div className="studio-empty" role="status">Loading…</div></StudioShell>
  if (!report) return <StudioShell title="Report"><div className="studio-empty" role="alert">That report no longer exists.</div></StudioShell>
  return <ReportEditor key={report.id + report.updatedAt} report={report} />
}

const inputOf = (r: InsightReport): InsightReportInput => ({ name: r.name, description: r.description, widgets: r.widgets, filters: r.filters, shared: r.shared })

function ReportEditor({ report }: { report: InsightReport }) {
  const navigate = useNavigate()
  const canEdit = useCanEditItem()(report)
  const { visuals } = useVisualLibrary()
  const readable = useReadableDatasets()
  const { createReport, updateReport, deleteReport } = useStudioMutations()
  const [draft, setDraft] = useState<InsightReportInput>(() => inputOf(report))
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const [editingWidget, setEditingWidget] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const byId = useMemo(() => new Map<string, InsightVisual>(visuals.map((v) => [v.id, v])), [visuals])
  const pickable = useMemo(() => visuals.filter((v) => readable.some((d) => d.id === v.spec.query.datasetId)), [visuals, readable])
  const dirty = JSON.stringify(draft) !== JSON.stringify(inputOf(report))
  const pending = createReport.isPending || updateReport.isPending

  const run = async (action: () => Promise<void>) => { setError(null); try { await action() } catch (e) { setError(errorText(e)) } }
  const save = () => run(async () => { await updateReport.mutateAsync({ id: report.id, ...draft }); setEditing(false) })
  const saveAsMine = () => run(async () => {
    const created = await createReport.mutateAsync({ ...draft, name: canEdit ? `${draft.name} (copy)`.slice(0, 120) : draft.name, shared: false })
    navigate(STUDIO_PATHS.report(created.id))
  })
  const target = draft.widgets.find((w) => w.id === editingWidget)

  const actions = (
    <div className="studio-row">
      {editing ? (
        <>
          <button type="button" className="studio-btn" onClick={() => setPicking(true)}><Icon name="Plus" size={14} />Add visual</button>
          <button type="button" className="studio-btn" onClick={() => setDraft({ ...draft, widgets: addWidget(draft.widgets, { kind: 'text', text: 'New section' }, defaultSize('text')) })}><Icon name="Type" size={14} />Add heading</button>
          <input className="studio-input" aria-label="Report name" maxLength={120} value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          <label className="studio-row"><input type="checkbox" checked={!!draft.shared} onChange={(e) => setDraft({ ...draft, shared: e.target.checked })} />Shared</label>
          <button type="button" className="studio-btn" onClick={() => { setDraft(inputOf(report)); setEditing(false) }}>Cancel</button>
          <button type="button" className="studio-btn studio-btn-primary" disabled={!dirty || pending} onClick={() => void save()}><Icon name="Check" size={14} />Save</button>
        </>
      ) : (
        <>
          {canEdit && <button type="button" className="studio-btn" onClick={() => setEditing(true)}><Icon name="Pencil" size={14} />Edit</button>}
          <button type="button" className="studio-btn" disabled={pending} onClick={() => void saveAsMine()}><Icon name="Copy" size={14} />{canEdit ? 'Duplicate' : 'Save as my report'}</button>
          {canEdit && dirty && <button type="button" className="studio-btn studio-btn-primary" disabled={pending} onClick={() => void save()}>Save filters</button>}
          {canEdit && <button type="button" className="studio-btn studio-btn-danger" onClick={() => setRemoving(true)}><Icon name="Trash2" size={14} />Delete</button>}
        </>
      )}
    </div>
  )

  return (
    <StudioShell title={draft.name} actions={actions}>
      {report.builtIn && <p className="studio-chip" style={{ marginBottom: 10 }}>Built-in template · read-only. Change filters freely, or “Save as my report” to edit the layout.</p>}
      {draft.description && <p style={{ marginBottom: 10, color: 'var(--s-muted)' }}>{draft.description}</p>}
      {error && <div role="alert" className="studio-error">{error}</div>}
      <ReportFiltersBar filters={draft.filters} onChange={(filters) => setDraft({ ...draft, filters })} />
      <ReportCanvas widgets={draft.widgets} visuals={byId} filters={draft.filters} editing={editing} onChange={(widgets) => setDraft({ ...draft, widgets })} onEdit={setEditingWidget} />
      <WidgetPicker open={picking} visuals={pickable} onClose={() => setPicking(false)}
        onPick={(v) => { setDraft({ ...draft, widgets: addWidget(draft.widgets, { kind: 'visual', visualId: v.id }, defaultSize(v.spec.chart)) }); setPicking(false) }} />
      {target && (
        <WidgetTextDialog key={target.id} open kind={target.kind} value={target.kind === 'text' ? target.text ?? '' : target.title ?? ''} onClose={() => setEditingWidget(null)}
          onSave={(value) => {
            const patch = target.kind === 'text' ? { text: value } : { title: value.trim() || undefined }
            setDraft({ ...draft, widgets: patchWidget(draft.widgets, target.id, patch) })
            setEditingWidget(null)
          }} />
      )}
      <ConfirmDeleteDialog open={removing} onClose={() => setRemoving(false)} itemLabel={report.name}
        onConfirm={async () => { await deleteReport.mutateAsync(report.id); navigate(STUDIO_PATHS.reports) }} />
    </StudioShell>
  )
}
