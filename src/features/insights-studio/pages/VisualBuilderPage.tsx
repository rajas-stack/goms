import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { getDataset, type InsightVisual, type VisualSpec } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { errorText, useCanEditItem, useStudioMutations, useVisualLibrary } from '../api'
import { ChartStep, type Details } from '../builder/ChartStep'
import { draftForSource, draftFromSpec, suggestName, type Draft } from '../builder/draft'
import { FieldsStep } from '../builder/FieldsStep'
import { SourceStep } from '../builder/SourceStep'
import { ChartView } from '../charts/ChartView'
import { useCanReadDataset, useDatasetRows, useReadableDatasets } from '../data/hooks'
import { STUDIO_PATHS } from '../paths'
import { StudioShell } from '../StudioShell'
import { useVisualResult } from '../VisualPanel'

const STEP_NAMES = ['Data source', 'Fields', 'Chart & name'] as const

/** Create / edit a visual: pick ONE data source → its fields → chart (with a recommendation) → save. */
export function VisualBuilderPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const { visuals, isLoading } = useVisualLibrary()
  const existing = id ? visuals.find((v) => v.id === id) : undefined
  if (id && isLoading) return <StudioShell title="Visual"><div className="studio-empty" role="status">Loading…</div></StudioShell>
  if (id && !existing) return <StudioShell title="Visual"><div className="studio-empty" role="alert">That visual no longer exists.</div></StudioShell>
  return <Builder key={id ?? 'new'} existing={existing} initialSource={params.get('source') ?? undefined} />
}

function Builder({ existing, initialSource }: { existing?: InsightVisual; initialSource?: string }) {
  const navigate = useNavigate()
  const canEdit = useCanEditItem()
  const datasets = useReadableDatasets()
  const editable = !existing || canEdit(existing)
  const startSource = initialSource && datasets.some((d) => d.id === initialSource) ? initialSource : undefined
  const [draft, setDraft] = useState<Draft | null>(() => (existing ? draftFromSpec(existing.spec) : startSource ? draftForSource(startSource) : null))
  const [step, setStep] = useState(existing || startSource ? 1 : 0)
  const [details, setDetails] = useState<Details>({ name: existing ? (editable ? existing.name : `${existing.name} (copy)`) : '', description: existing?.description ?? '', shared: editable ? existing?.shared ?? false : false })
  const [error, setError] = useState<string | null>(null)
  const { createVisual, updateVisual } = useStudioMutations()
  const datasetId = draft?.spec.query.datasetId
  const dataset = datasetId ? getDataset(datasetId) : undefined
  const canRead = useCanReadDataset(datasetId)
  const rows = useDatasetRows(canRead ? datasetId : undefined)

  const named = useRef(!!existing)
  useEffect(() => {
    if (step !== 2 || !draft || named.current) return
    named.current = true
    setDetails((d) => (d.name ? d : { ...d, name: suggestName(draft.spec) }))
  }, [step, draft])

  const pickSource = (sourceId: string) => {
    if (draft?.spec.query.datasetId !== sourceId) setDraft(draftForSource(sourceId))
    setStep(1)
  }
  const save = async () => {
    if (!draft) return
    setError(null)
    const input = { name: details.name || suggestName(draft.spec), description: details.description, shared: details.shared, spec: draft.spec }
    try {
      if (existing && editable) await updateVisual.mutateAsync({ id: existing.id, ...input })
      else await createVisual.mutateAsync(input)
      navigate(STUDIO_PATHS.visuals)
    } catch (e) { setError(errorText(e)) }
  }
  const pending = createVisual.isPending || updateVisual.isPending
  const title = existing ? (editable ? `Edit visual · ${existing.name}` : `${existing.name} (read-only — saving makes your copy)`) : 'New visual'

  return (
    <StudioShell title={title}>
      <ol className="studio-steps" aria-label="Steps">
        {STEP_NAMES.map((name, i) => (
          <li key={name} aria-current={step === i ? 'step' : undefined}>
            <button type="button" disabled={i > 0 && !draft} onClick={() => setStep(i)}><b>{i + 1}</b> {name}</button>
            {i < STEP_NAMES.length - 1 && <Icon name="ChevronRight" size={14} />}
          </li>
        ))}
      </ol>
      {step === 0 || !draft || !dataset ? <SourceStep datasets={datasets} selected={datasetId} onPick={pickSource} /> : (
        <div className="studio-builder">
          {step === 1
            ? <FieldsStep dataset={dataset} draft={draft} rows={rows.data} onChange={setDraft} onSuggestion={(s) => { setDraft(draftFromSpec(s.spec)); setDetails((d) => ({ ...d, name: s.name, description: s.description })) }} />
            : <ChartStep dataset={dataset} draft={draft} rows={rows.data} details={details} onChange={setDraft} onDetails={setDetails} />}
          <section className="studio-panel" aria-label="Live preview">
            <div className="studio-row">
              <h2 style={{ marginRight: 'auto' }}>Preview</h2>
              <span className="studio-chip studio-chip-accent">Source: {dataset.label}</span>
            </div>
            <Preview spec={draft.spec} title={details.name || suggestName(draft.spec)} canRead={canRead} />
            {error && <div role="alert" className="studio-error">{error}</div>}
            <div className="studio-row">
              <button type="button" className="studio-btn" onClick={() => setStep(step - 1)}><Icon name="ChevronLeft" size={14} />Back</button>
              {step === 1
                ? <button type="button" className="studio-btn studio-btn-primary" onClick={() => setStep(2)}>Next: chart<Icon name="ChevronRight" size={14} /></button>
                : <button type="button" className="studio-btn studio-btn-primary" disabled={pending} onClick={() => void save()}><Icon name="Check" size={14} />{existing && editable ? 'Save changes' : 'Save visual'}</button>}
            </div>
          </section>
        </div>
      )}
    </StudioShell>
  )
}

function Preview({ spec, title, canRead }: { spec: VisualSpec; title: string; canRead: boolean }) {
  const { state, isLoading, isError, rows } = useVisualResult(canRead ? spec : null)
  if (!canRead) return <div className="studio-empty">You do not have access to this data source.</div>
  if (isLoading) return <div className="studio-empty" role="status">Loading live data…</div>
  if (isError) return <div className="studio-empty" role="alert">The data could not be loaded.</div>
  if (!state) return null
  if (state.error !== null) return <div className="studio-empty" role="alert">{state.error}</div>
  return (
    <div className="studio-preview">
      <p className="studio-chip">{state.result.matched} of {rows} records match</p>
      <ChartView chart={spec.chart} result={state.result} previous={state.previous} title={title} />
    </div>
  )
}
