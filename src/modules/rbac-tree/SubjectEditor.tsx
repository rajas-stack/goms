import { useEffect, useMemo, useState } from 'react'
import {
  applyGrantChanges, diffGrantMaps, toGrantMap,
  type RbacAction, type RbacCellValue, type RbacGrantMap, type RbacNode, type RbacSubjectRef, type RbacSubjects,
} from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { Input } from '@/components/ui/Field'
import { useToast } from '@/components/ui/Toast'
import { errorText, useRbacConfig, useRbacMutations, useTemplateGrants } from './api'
import { SubjectActions, subjectTitle } from './SubjectActions'
import { TreeTable } from './TreeTable'
import { allParentIds, applyToChildren, resolveSubject, visibleRows } from './treeModel'

const EMPTY: RbacGrantMap = {}
const KIND_NOUN: Record<RbacSubjectRef['type'], string> = { role: 'role', user: 'user', template: 'template' }

/** Right column: the tree table for one role / user / template, with a local draft until Save. */
export function SubjectEditor({ subject, subjects, nodes, canEdit, onDirtyChange, onSelect }: {
  subject: RbacSubjectRef; subjects: RbacSubjects | undefined; nodes: RbacNode[]; canEdit: boolean
  onDirtyChange: (dirty: boolean) => void; onSelect: (s: RbacSubjectRef | null) => void
}) {
  const config = useRbacConfig(subject)
  const template = useTemplateGrants(config.data?.templateId ?? null)
  const { setConfig } = useRbacMutations()
  const toast = useToast()
  const baseline = useMemo(() => (config.data ? toGrantMap(config.data.grants) : EMPTY), [config.data])
  const [draft, setDraft] = useState<RbacGrantMap>(EMPTY)
  useEffect(() => setDraft(baseline), [baseline])
  const changes = useMemo(() => diffGrantMaps(baseline, draft), [baseline, draft])
  useEffect(() => onDirtyChange(changes.length > 0), [changes.length, onDirtyChange])

  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [query, setQuery] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const templateMap = useMemo(() => (template.data ? toGrantMap(template.data.grants) : null), [template.data])
  const resolution = useMemo(() => resolveSubject(nodes, draft, templateMap), [nodes, draft, templateMap])
  const rows = useMemo(() => visibleRows(nodes, { expanded, query, showRetired }), [nodes, expanded, query, showRetired])
  const labels = useMemo(() => new Map(nodes.map((n) => [n.id, n.label])), [nodes])
  const templateName = subjects?.templates.find((t) => t.id === config.data?.templateId)?.name
  const noun = KIND_NOUN[subject.type]
  const retiredCount = nodes.filter((n) => n.retired).length

  const onCell = (nodeId: string, action: RbacAction, value: RbacCellValue) => setDraft((d) => applyGrantChanges(d, [{ nodeId, action, value }]))
  const save = async () => {
    try { await setConfig.mutateAsync({ subject, changes }); toast(`Saved ${changes.length} change${changes.length === 1 ? '' : 's'}.`) } catch (e) {
      toast(errorText(e, 'Could not save the changes.'), undefined, 'error')
    }
  }

  return (
    <section aria-label={`Permissions for ${subjectTitle(subject, subjects)}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted">{noun}</p>
          <h2 className="truncate font-display text-lg font-semibold text-ink-900">{subjectTitle(subject, subjects)}</h2>
        </div>
        <SubjectActions subject={subject} subjects={subjects} canEdit={canEdit} dirty={changes.length > 0} onSelect={onSelect} />
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Icon name="Search" size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <Input type="search" aria-label="Search areas" placeholder="Search pages, tabs, sections…" value={query} onChange={(e) => setQuery(e.target.value)} className="h-8 pl-8" />
        </div>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set(allParentIds(nodes)))}><Icon name="ChevronsDown" size={14} /> Expand all</Button>
        <Button size="sm" variant="ghost" onClick={() => setExpanded(new Set())}><Icon name="ChevronsUp" size={14} /> Collapse all</Button>
        {retiredCount > 0 && (
          <label className="ml-auto flex items-center gap-1.5 text-[12.5px] text-muted">
            <input type="checkbox" checked={showRetired} onChange={(e) => setShowRetired(e.target.checked)} /> Show retired ({retiredCount})
          </label>
        )}
        <Legend />
      </div>

      {config.isLoading
        ? <p className="p-6 text-[13px] text-muted">Loading…</p>
        : config.isError
          ? <p role="alert" className="p-6 text-[13px] text-crimson">{errorText(config.error, 'Could not load these permissions.')}</p>
          : <TreeTable rows={rows} draft={draft} resolution={resolution} expanded={expanded} readOnly={!canEdit}
              labelOf={(id) => (id ? labels.get(id) ?? id : 'the top level')}
              sourceName={(layer) => (layer === 'template' ? `template “${templateName ?? '…'}”` : `this ${noun}`)}
              onToggle={(id) => setExpanded((cur) => { const next = new Set(cur); if (next.has(id)) next.delete(id); else next.add(id); return next })}
              onCell={onCell} onApplyToChildren={(id) => setDraft((d) => applyToChildren(d, id))} />}

      {changes.length > 0 && (
        <div role="status" className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-amber/10 px-4 py-2.5">
          <span className="text-[13px] text-ink-800"><strong>{changes.length}</strong> unsaved change{changes.length === 1 ? '' : 's'}</span>
          <div className="flex gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDraft(baseline)}>Discard</Button>
            <Button size="sm" variant="primary" disabled={setConfig.isPending} onClick={() => void save()}>{setConfig.isPending ? 'Saving…' : 'Save changes'}</Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Legend() {
  const swatch = 'inline-flex h-4 w-5 items-center justify-center rounded border'
  return (
    <span className="flex items-center gap-2.5 text-[11.5px] text-muted" aria-label="Legend">
      <span className="flex items-center gap-1"><span className={`${swatch} border-emerald-500/50 bg-emerald-500/15`} />Allow</span>
      <span className="flex items-center gap-1"><span className={`${swatch} border-crimson/50 bg-crimson/15`} />Deny</span>
      <span className="flex items-center gap-1" title="Inherited from the row above"><span className={`${swatch} border-dashed border-line`} />Inherit</span>
    </span>
  )
}
