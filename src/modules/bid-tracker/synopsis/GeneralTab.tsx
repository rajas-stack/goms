import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Loader2, Pencil, Plus, RotateCcw } from 'lucide-react'
import type { BidCustomField, BidGridRow } from '@/lib/types'
import type { BidSynopsis, PolicyModuleKey } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { PersonName } from '@/components/ui/PersonName'
import { useBidCustomFields, useBidsForGrid, useMyAccess } from '@/lib/api'
import { useAllowed, usePermissions } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { EditableCell, type CellDraft, type PendingEdits } from '../components/EditableCell'
import { AddCustomColumnDialog } from '../components/AddCustomColumnDialog'
import { useBidStageOptions } from '@/features/masters/useBidStages'
import { CUSTOM_GROUP, GRID_GROUPS, cellValue, editValue, formatValueText, personOf, resolveColumns, type GridColumnMeta } from '../gridColumns'
import { canEditCell } from '../gridPermissions'
import { columnInScope, columnOwner } from '../sheets'
import { useBidColumnMutation } from '../useBidColumnMutation'
import { useEntityLookups } from '../useEntityLookups'
import { useSynopsis } from './api'
import { GeneralFieldControl } from './GeneralFieldControl'
import { GeneralFieldValue } from './GeneralFieldValue'

export function GeneralTab({ bidId, module = 'opp.bidTracker', actionsTarget }: { bidId: string; module?: PolicyModuleKey; actionsTarget?: HTMLDivElement | null }) {
  const canEdit = useAllowed(module, 'update')
  const synopsis = useSynopsis(bidId, 'general')
  const rows = useBidsForGrid()
  const fields = useBidCustomFields()
  if (synopsis.isLoading || rows.isLoading || fields.isLoading) return <div role="status" className="p-6 text-sm text-muted">Loading General...</div>
  const error = synopsis.error ?? rows.error ?? fields.error
  if (error) return <div role="alert" className="space-y-2 p-6 text-sm text-crimson"><p>{error.message}</p><Button size="sm" onClick={() => { void synopsis.refetch(); void rows.refetch(); void fields.refetch() }}>Retry</Button></div>
  const row = rows.data?.find(candidate => candidate.id === bidId)
  if (!row) return <p role="alert" className="p-6 text-sm text-crimson">Bid not found.</p>
  return <GeneralForm key={bidId} row={row} fields={fields.data ?? []} saved={synopsis.data ?? null} canEdit={canEdit} actionsTarget={actionsTarget} onReload={() => { void synopsis.refetch(); void rows.refetch(); void fields.refetch() }} />
}

function GeneralForm({ row, fields, saved, canEdit, actionsTarget, onReload }: {
  row: BidGridRow; fields: BidCustomField[]; saved: BidSynopsis | null; canEdit: boolean; actionsTarget?: HTMLDivElement | null; onReload: () => void
}) {
  const [editingRequested, setEditing] = useState(() => !saved)
  const [addFieldOpen, setAddFieldOpen] = useState(false)
  const [doneRequested, setDoneRequested] = useState(false)
  const canAddField = useAllowed('bid.columns', 'create')
  const [errors, setErrors] = useState<Record<string, string>>({})
  const pending: PendingEdits = useRef(new Map())
  const lookups = useEntityLookups()
  const permissions = usePermissions()
  const { data: access } = useMyAccess()
  const me = { email: access?.email ?? '', salesPersonId: access?.facts?.salesPersonId ?? null }
  const mutation = useBidColumnMutation(lookups)
  const editing = canEdit && editingRequested
  useEffect(() => {
    if (doneRequested && !mutation.isPending && pending.current.size === 0 && Object.keys(errors).length === 0) { setEditing(false); setDoneRequested(false) }
  }, [doneRequested, mutation.isPending, row, errors])
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (pending.current.size || mutation.isPending) { event.preventDefault(); event.returnValue = '' } }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [mutation.isPending])
  const stageOptions = useBidStageOptions()
  const columns = useMemo(() => resolveColumns(fields.filter(field => columnInScope(field.sheet, row.sheet)), undefined, stageOptions).filter(column => column.type !== null), [fields, row.sheet, stageOptions])
  const groups = [...GRID_GROUPS, CUSTOM_GROUP].map(group => ({ ...group, columns: columns.filter(column => column.group === group.id) })).filter(group => group.columns.length)

  const commit = async (col: GridColumnMeta, value: CellDraft) => {
    setErrors(current => { const { [col.id]: _removed, ...rest } = current; return rest })
    try { await mutation.mutateAsync({ row, col, value }) }
    catch (error) { setErrors(current => ({ ...current, [col.id]: error instanceof Error ? error.message : 'Could not save.' })) }
  }

  const done = () => {
    setDoneRequested(true)
  }

  const actions = <>
    {canAddField && <Button size="sm" onClick={() => setAddFieldOpen(true)}><Plus size={14} /> Add field</Button>}
    <Button size="sm" disabled={mutation.isPending} onClick={onReload} aria-label="Reload saved values" title="Reload saved values"><RotateCcw size={14} /></Button>
    {canEdit && <Button size="sm" variant="primary" disabled={mutation.isPending && !editing} onClick={() => editing ? done() : setEditing(true)}>
      {editing ? <><Check size={14} /> Done</> : <><Pencil size={14} /> Edit</>}
    </Button>}
  </>

  return (
    <section aria-label="General" className="min-w-0" data-testid="bid-general-form">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-4 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-ink-900">General Information</h2>
          <span role="status" className="inline-flex items-center gap-1.5 text-xs text-muted">
            {mutation.isPending ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : Object.keys(errors).length ? 'Save failed' : <><Check size={14} className="text-emerald" /> Saved</>}
          </span>
        </div>
        {actionsTarget ? createPortal(actions, actionsTarget) : <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
      <div className="px-4 pb-6">
        {groups.map(group => (
          <section key={group.id} aria-label={group.label} className="border-b border-line py-4">
            <h3 className="mb-2 text-sm font-semibold text-ink-900">{group.label}</h3>
            <dl className="divide-y divide-line">
              {group.columns.map(col => {
                const value = cellValue(row, col)
                const person = personOf(col, value, lookups)
                const editable = editing && !!col.editable && canEditCell(permissions, row, col.id, me)
                const display = col.generalField ? <GeneralFieldValue field={col.generalField} value={String(value ?? '')} />
                  : person ? <PersonName person={person} size="xs" nameClassName="whitespace-pre-wrap overflow-visible [overflow-wrap:anywhere]" /> : formatValueText(col, value, lookups) || <span className="text-muted">-</span>
                return (
                  <div key={col.id} className="grid gap-2 py-2 md:grid-cols-[minmax(180px,280px)_1fr] md:gap-4" data-column-id={col.id}>
                    <dt className="text-sm font-medium text-ink-700">{col.header}</dt>
                    <dd className="relative min-w-0 whitespace-pre-wrap [overflow-wrap:anywhere] text-sm text-ink-900" data-field={col.generalField?.key ?? col.id} title={!col.editable ? col.readOnlyReason : undefined}>
                      {editable ? col.generalField && col.type !== 'multiselect' ? <GeneralControl key={col.id} col={col} value={String(value ?? '')} onCommit={next => commit(col, next)} pending={pending} />
                        : <EditableCell col={col} value={editValue(row, col)} display={display} lookups={lookups} row={row} pending={pending} cellKey={row.id + ':' + col.id} onCommit={next => void commit(col, next)} externalError={errors[col.id]} />
                        : display}
                      {errors[col.id] && <p role="alert" className="mt-1 text-xs text-crimson">{errors[col.id]}</p>}
                    </dd>
                  </div>
                )
              })}
            </dl>
          </section>
        ))}
      </div>
      <div className="flex flex-wrap gap-4 border-t border-line px-4 py-2 text-xs text-muted">
        {saved && <span>Revision {saved.revision}</span>}
        <span>Updated {new Date(row.updatedAt).toLocaleString('en-IN')}</span>
      </div>
      <AddCustomColumnDialog open={addFieldOpen} onClose={() => setAddFieldOpen(false)} sheet={columnOwner(row.sheet)} />
    </section>
  )
}

function GeneralControl({ col, value, onCommit, pending }: {
  col: GridColumnMeta; value: string; onCommit: (value: string) => Promise<void>; pending: PendingEdits
}) {
  const [draft, setDraft] = useState(value)
  const draftRef = useRef(value)
  const invalid = useRef(false)
  const lastSubmitted = useRef<string | null>(null)
  useEffect(() => { draftRef.current = value; setDraft(value) }, [value])
  useEffect(() => {
    if (draft === value) return
    pending.current.set(col.id, { discard: () => { draftRef.current = value; setDraft(value) } })
    return () => { pending.current.delete(col.id) }
  }, [draft, value, pending, col.id])
  const save = (next = draftRef.current) => {
    if (invalid.current || next === value || lastSubmitted.current === next) return
    lastSubmitted.current = next
    void onCommit(next).finally(() => { if (lastSubmitted.current === next) lastSubmitted.current = null })
  }
  const field = { ...col.generalField!, label: col.header }
  return (
    <div onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) save() }}
      onKeyDown={event => { if (event.key === 'Enter' && field.kind !== 'textarea' && field.kind !== 'address') { event.preventDefault(); save() } }}>
      <GeneralFieldControl field={field} value={draft}
        onChange={next => { draftRef.current = next; setDraft(next); if (field.kind === 'select' || field.kind === 'department' || field.kind === 'websites') save(next) }}
        onValidityChange={next => { invalid.current = next }} />
    </div>
  )
}
