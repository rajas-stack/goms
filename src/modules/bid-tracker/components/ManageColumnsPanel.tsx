import { useState } from 'react'
import { Badge } from '@/components/ui/Badge'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useBidCustomFields, useBidCustomFieldMutations } from '@/lib/api'
import { cn } from '@/lib/utils'
import type { BidCustomField } from '@/lib/types'
import { hasOptions } from '@goms/domain'
import { CUSTOM_TYPE_LABEL, type GridColumnMeta } from '../gridColumns'
import { ColumnsPanel } from './ColumnsPanel'
import { OptionsEditor } from './OptionsEditor'

const box = 'h-8 min-w-0 flex-1 rounded-lg border border-line bg-white px-2 text-[13px] text-ink focus-visible:focus-ring'

/** The Columns popover: visibility + order for every column (ColumnsPanel), and
 *  below it the management of the user-defined columns — rename, edit options,
 *  default order, archive, restore, and delete (only for a column that has never
 *  held a value; everything else is archive-only, spec §8.1). */
export function ManageColumnsPanel({ all, visible, columnOrder, onVisibleChange, focusId, inScope }: {
  all: GridColumnMeta[]
  visible: GridColumnMeta[]
  columnOrder?: string[]
  onVisibleChange: (orderedVisibleIds: string[]) => void
  /** Column to scroll to and highlight (opened from its header's "Manage column…"). */
  focusId?: string | null
  /** Which custom columns this panel manages (the sheet's own; Master: all or the switcher's pick). */
  inScope?: (field: BidCustomField) => boolean
}) {
  const { data: fields = [] } = useBidCustomFields(true)
  const { update, reorder, archive, unarchive, remove } = useBidCustomFieldMutations()
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null)
  const [editingOptions, setEditingOptions] = useState<{ id: string; options: string[] } | null>(null)
  const [error, setError] = useState<string | null>(null)

  const scoped = inScope ? fields.filter(inScope) : fields
  const active = scoped.filter((f) => f.status === 'active').sort((a, b) => a.position - b.position)
  const archived = scoped.filter((f) => f.status === 'archived')

  const run = async (action: () => Promise<unknown>) => {
    setError(null)
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.') }
  }

  const saveRename = () => run(async () => {
    if (!renaming) return
    await update.mutateAsync({ id: renaming.id, patch: { name: renaming.name } })
    setRenaming(null)
  })

  const saveOptions = (field: BidCustomField) => run(async () => {
    if (!editingOptions) return
    const next = editingOptions.options.map((o) => o.trim()).filter(Boolean)
    const removed = (field.options ?? []).filter((o) => !next.includes(o))
    if (removed.length && field.hasHeldValue
      && !window.confirm(`Remove ${removed.join(', ')}? Existing values that use a removed option are kept, but it can no longer be chosen.`)) return
    await update.mutateAsync({ id: field.id, patch: { options: editingOptions.options } })
    setEditingOptions(null)
  })

  const move = (index: number, delta: -1 | 1) => run(async () => {
    const ids = active.map((f) => f.id)
    const t = index + delta
    if (t < 0 || t >= ids.length) return
    ;[ids[index], ids[t]] = [ids[t], ids[index]]
    await reorder.mutateAsync(ids)
  })

  const doArchive = (f: BidCustomField) => {
    if (!window.confirm(`Archive "${f.name}"? Its values are kept and you can restore the column later.`)) return
    void run(() => archive.mutateAsync(f.id))
  }
  const doDelete = (f: BidCustomField) => {
    const message = f.hasHeldValue
      ? `Delete "${f.name}" permanently? Every value in it is deleted too and cannot be recovered. (Archive keeps the values.)`
      : `Delete "${f.name}"? It has never held a value, so nothing is lost.`
    if (!window.confirm(message)) return
    void run(() => remove.mutateAsync({ id: f.id, withValues: f.hasHeldValue }))
  }

  const deleteButton = (f: BidCustomField) => (
    <Button variant="ghost" size="icon" aria-label={`Delete ${f.name}`} title="Delete column" onClick={() => doDelete(f)}><Icon name="Trash2" size={14} /></Button>
  )

  return (
    <div className="flex flex-col divide-y divide-line" data-testid="manage-columns-panel">
      <ColumnsPanel all={all} visible={visible} columnOrder={columnOrder} onChange={onVisibleChange} focusId={focusId} onDeleteCustom={doDelete} />

      {/* Nothing to manage yet → no section at all (no empty heading or hint);
          creating the first custom column is the toolbar's Add column button. */}
      {(active.length > 0 || archived.length > 0 || error) && (
      <div className="flex w-80 max-w-[calc(100vw-2rem)] flex-col gap-2 p-3">
        {active.length > 0 && (
          <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted">Custom columns ({active.length})</h3>
        )}
        {error && <p role="alert" className="text-[12px] text-crimson">{error}</p>}
        <ul className="flex flex-col gap-1">
          {active.map((f, i) => (
            <li
              key={f.id} data-testid="custom-column-row" aria-current={focusId === `custom:${f.key}` ? 'true' : undefined}
              className={cn('rounded-md px-1 py-0.5 hover:bg-goms-sky/[0.1]', focusId === `custom:${f.key}` && 'bg-goms-sky/20 ring-1 ring-goms-sky')}
            >
              {renaming?.id === f.id ? (
                <div className="flex items-center gap-1">
                  <input
                    aria-label={`New name for ${f.name}`} className={box} value={renaming.name} autoFocus maxLength={80}
                    onChange={(e) => setRenaming({ id: f.id, name: e.target.value })}
                    onKeyDown={(e) => { if (e.key === 'Enter') void saveRename(); if (e.key === 'Escape') setRenaming(null) }}
                  />
                  <Button variant="ghost" size="icon" aria-label="Save name" disabled={!renaming.name.trim()} onClick={() => void saveRename()}><Icon name="Check" size={14} /></Button>
                  <Button variant="ghost" size="icon" aria-label="Cancel rename" onClick={() => setRenaming(null)}><Icon name="X" size={14} /></Button>
                </div>
              ) : (
                <div className="flex items-center gap-1">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{f.name} <Badge tone="gray">{CUSTOM_TYPE_LABEL[f.dataType]}</Badge></span>
                  <Button variant="ghost" size="icon" aria-label={`Rename ${f.name}`} onClick={() => setRenaming({ id: f.id, name: f.name })}><Icon name="Pencil" size={14} /></Button>
                  {hasOptions(f.dataType) && (
                    <Button variant="ghost" size="icon" aria-label={`Edit options for ${f.name}`} onClick={() => setEditingOptions({ id: f.id, options: f.options ?? [] })}><Icon name="List" size={14} /></Button>
                  )}
                  <Button variant="ghost" size="icon" aria-label={`Move ${f.name} earlier by default`} title="Earlier in the default column order (new views)" disabled={i === 0} onClick={() => void move(i, -1)}><Icon name="ArrowUp" size={14} /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Move ${f.name} later by default`} title="Later in the default column order (new views)" disabled={i === active.length - 1} onClick={() => void move(i, 1)}><Icon name="ArrowDown" size={14} /></Button>
                  <Button variant="ghost" size="icon" aria-label={`Archive ${f.name}`} onClick={() => doArchive(f)}><Icon name="Archive" size={14} /></Button>
                  {deleteButton(f)}
                </div>
              )}
              {editingOptions?.id === f.id && (
                <div className="mt-2 flex flex-col gap-2 rounded-lg border border-line p-2">
                  <OptionsEditor value={editingOptions.options} onChange={(options) => setEditingOptions({ id: f.id, options })} />
                  <div className="flex justify-end gap-2">
                    <Button variant="secondary" size="sm" onClick={() => setEditingOptions(null)}>Cancel</Button>
                    <Button variant="primary" size="sm" onClick={() => void saveOptions(f)}>Save options</Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>

        {archived.length > 0 && (
          <div className="pt-1">
            <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Archived columns ({archived.length})</h3>
            <ul className="flex flex-col">
              {archived.map((f) => (
                <li key={f.id} className="flex items-center gap-1 rounded-md px-1 py-0.5 hover:bg-ink-900/[0.04]" data-testid="archived-column-row">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-muted">{f.name}</span>
                  <Button variant="ghost" size="sm" aria-label={`Restore ${f.name}`} onClick={() => void run(() => unarchive.mutateAsync(f.id))}>
                    <Icon name="ArchiveRestore" size={14} /> Restore
                  </Button>
                  {deleteButton(f)}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      )}
    </div>
  )
}
