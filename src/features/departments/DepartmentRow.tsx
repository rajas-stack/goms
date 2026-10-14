import { useState } from 'react'
import { SYSTEM_DEPARTMENT_LOCKED, type AmnexDepartment } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Input } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

export interface DepartmentRowProps {
  department: AmnexDepartment
  isFirst: boolean
  isLast: boolean
  canRename: boolean
  canReorder: boolean
  canDelete: boolean
  onRename: (department: AmnexDepartment, name: string) => Promise<boolean>
  onMove: (department: AmnexDepartment, step: -1 | 1) => void
  onDelete: (department: AmnexDepartment) => void
}

/** One Amnex department: name (renamed in place), its employee count, reorder arrows and delete. System departments are
 *  locked: their names derive roles and team rosters. */
export function DepartmentRow({ department: d, isFirst, isLast, canRename, canReorder, canDelete, onRename, onMove, onDelete }: DepartmentRowProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(d.name)
  const locked = !!d.systemKey
  const save = async () => {
    if (draft.trim() === d.name) { setEditing(false); return }
    if (await onRename(d, draft)) setEditing(false)
  }

  return (
    <li className="group flex items-center gap-2 border-b border-line/70 px-3 py-2 last:border-b-0 hover:bg-grid-hover">
      {canReorder && (
        <span className="flex flex-col">
          <button type="button" aria-label={`Move ${d.name} up`} disabled={isFirst} onClick={() => onMove(d, -1)}
            className="rounded text-muted hover:text-ink-900 disabled:opacity-25"><Icon name="ChevronUp" size={13} /></button>
          <button type="button" aria-label={`Move ${d.name} down`} disabled={isLast} onClick={() => onMove(d, 1)}
            className="rounded text-muted hover:text-ink-900 disabled:opacity-25"><Icon name="ChevronDown" size={13} /></button>
        </span>
      )}
      <div className="min-w-0 flex-1">
        {editing ? (
          <form className="flex items-center gap-1.5" onSubmit={(e) => { e.preventDefault(); void save() }}>
            <Input autoFocus aria-label={`Rename ${d.name}`} value={draft} onChange={(e) => setDraft(e.target.value)} className="h-8 max-w-xs"
              onKeyDown={(e) => { if (e.key === 'Escape') { setDraft(d.name); setEditing(false) } }} />
            <Button type="submit" size="sm" variant="primary">Save</Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => { setDraft(d.name); setEditing(false) }}>Cancel</Button>
          </form>
        ) : (
          <span className="flex items-center gap-2">
            <span className="truncate text-[13.5px] font-medium text-ink-900">{d.name}</span>
            {locked && (
              <span title={SYSTEM_DEPARTMENT_LOCKED} className="inline-flex items-center gap-1 rounded-full border border-goms-navy/25 bg-goms-navy/[0.06] px-1.5 py-px text-[10.5px] font-semibold text-goms-navy">
                <Icon name="Lock" size={10} /> System · drives roles
              </span>
            )}
          </span>
        )}
      </div>
      <span className={cn('w-28 shrink-0 text-right text-[12px] tabular-nums', d.employeeCount ? 'text-ink-700' : 'text-muted')}>
        {d.employeeCount} employee{d.employeeCount === 1 ? '' : 's'}
      </span>
      <span className="flex w-16 shrink-0 justify-end gap-0.5">
        {!locked && !editing && canRename && (
          <Button variant="ghost" size="icon" aria-label={`Rename ${d.name}`} title="Rename" onClick={() => { setDraft(d.name); setEditing(true) }}>
            <Icon name="Pencil" size={13} />
          </Button>
        )}
        {!locked && canDelete && (
          <Button variant="ghost" size="icon" aria-label={`Delete ${d.name}`} title="Delete" onClick={() => onDelete(d)}>
            <Icon name="Trash2" size={13} />
          </Button>
        )}
      </span>
    </li>
  )
}
