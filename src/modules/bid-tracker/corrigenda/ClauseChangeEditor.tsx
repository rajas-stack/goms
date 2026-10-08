import { useMemo } from 'react'
import {
  CORRIGENDUM_AFFECTED_MODULES, CORRIGENDUM_CHANGE_CLASSIFICATIONS, CORRIGENDUM_CLASSIFICATION_LABELS, CORRIGENDUM_IMPACT_LABELS,
  CORRIGENDUM_IMPACT_LEVELS, CORRIGENDUM_MODULE_LABELS, type CorrigendumAffectedModule, type CorrigendumChangeClassification,
  type CorrigendumImpactLevel,
} from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Field, Input, Select, Textarea } from '@/components/ui/Field'
import { WhatChanged } from './DiffText'
import { diffText } from './textDiff'
import { currentSourceLabel, type ClauseHistory } from './tenderPosition'

export interface ClauseDraft {
  /** '' = a clause not yet tracked (its original text is typed in once). */
  existingKey: string
  title: string
  module: CorrigendumAffectedModule
  classification: CorrigendumChangeClassification
  impact: CorrigendumImpactLevel
  sourceRef: string
  original: string
  modified: string
}
export const emptyClauseDraft = (): ClauseDraft => ({
  existingKey: '', title: '', module: 'pq', classification: 'modified', impact: 'medium', sourceRef: '', original: '', modified: '',
})

/** One clause change in the Record Corrigendum dialog. Picking an already
 *  tracked clause locks its "before" text to the current effective value, so
 *  a new corrigendum always chains from the latest version. */
export function ClauseChangeEditor({ index, draft, clauses, usedKeys, onChange, onRemove }: {
  index: number; draft: ClauseDraft; clauses: ClauseHistory[]; usedKeys: Set<string>
  onChange: (next: ClauseDraft) => void; onRemove?: () => void
}) {
  const set = <K extends keyof ClauseDraft>(key: K, v: ClauseDraft[K]) => onChange({ ...draft, [key]: v })
  const existing = clauses.find((c) => c.key === draft.existingKey)
  const preview = useMemo(() => diffText(draft.original, draft.modified), [draft.original, draft.modified])

  function pickClause(key: string) {
    const h = clauses.find((c) => c.key === key)
    onChange(h
      ? { ...draft, existingKey: key, title: h.title, module: h.module, original: h.current.value }
      : { ...draft, existingKey: '', original: '' })
  }

  return (
    <fieldset data-testid="clause-change" className="space-y-3 rounded-xl border border-line bg-panel/40 p-3.5">
      <legend className="px-1 text-[12px] font-semibold uppercase tracking-wider text-muted">Change {index + 1}</legend>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Clause">
          <Select aria-label={`Clause ${index + 1}`} value={draft.existingKey} onChange={(e) => pickClause(e.target.value)}>
            <option value="">New clause…</option>
            {clauses.map((c) => (
              <option key={c.key} value={c.key} disabled={usedKeys.has(c.key) && c.key !== draft.existingKey}>
                {c.title} ({currentSourceLabel(c)})
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Clause title" required>
          <Input aria-label={`Clause title ${index + 1}`} value={draft.title} maxLength={300} disabled={!!existing}
            placeholder="e.g. PQ 2.1 — Average Annual Turnover" onChange={(e) => set('title', e.target.value)} />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Affected module">
          <Select aria-label={`Affected module ${index + 1}`} value={draft.module} onChange={(e) => set('module', e.target.value as CorrigendumAffectedModule)}>
            {CORRIGENDUM_AFFECTED_MODULES.map((m) => <option key={m} value={m}>{CORRIGENDUM_MODULE_LABELS[m]}</option>)}
          </Select>
        </Field>
        <Field label="Classification">
          <Select aria-label={`Classification ${index + 1}`} value={draft.classification} onChange={(e) => set('classification', e.target.value as CorrigendumChangeClassification)}>
            {CORRIGENDUM_CHANGE_CLASSIFICATIONS.map((c) => <option key={c} value={c}>{CORRIGENDUM_CLASSIFICATION_LABELS[c]}</option>)}
          </Select>
        </Field>
        <Field label="Impact">
          <Select aria-label={`Impact ${index + 1}`} value={draft.impact} onChange={(e) => set('impact', e.target.value as CorrigendumImpactLevel)}>
            {CORRIGENDUM_IMPACT_LEVELS.map((l) => <option key={l} value={l}>{CORRIGENDUM_IMPACT_LABELS[l]}</option>)}
          </Select>
        </Field>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Field label={existing ? `Original clause (${currentSourceLabel(existing).toLowerCase()})` : 'Original clause'} hint={existing ? 'Locked to the current effective text.' : 'Leave empty if the corrigendum adds a new clause.'}>
          <Textarea aria-label={`Original clause ${index + 1}`} value={draft.original} readOnly={!!existing} maxLength={20000}
            className={existing ? 'bg-panel text-ink-700' : undefined} onChange={(e) => set('original', e.target.value)} />
        </Field>
        <Field label="Modified clause" hint="Leave empty if the corrigendum deletes the clause.">
          <Textarea aria-label={`Modified clause ${index + 1}`} value={draft.modified} maxLength={20000} onChange={(e) => set('modified', e.target.value)} />
        </Field>
      </div>
      <Field label="Source (page / clause in the corrigendum)">
        <Input aria-label={`Source ${index + 1}`} value={draft.sourceRef} maxLength={300} placeholder="e.g. Corrigendum 02, Page 4, Clause 18.2" onChange={(e) => set('sourceRef', e.target.value)} />
      </Field>
      {(draft.original || draft.modified) && (
        <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
          <span className="shrink-0 pt-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted">Preview</span>
          <WhatChanged hunks={preview.hunks} />
        </div>
      )}
      {onRemove && <div className="text-right"><Button size="sm" variant="ghost" onClick={onRemove}>Remove change</Button></div>}
    </fieldset>
  )
}
