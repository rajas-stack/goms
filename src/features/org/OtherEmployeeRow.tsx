import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { NO_PERMISSION_TITLE } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { SourceBadges } from './SourceBadges'
import type { MasterEmployee } from './masterEmployees'

const CELL = 'border-b border-line/70 px-3 py-1.5'

/** A person who is in another roster (Sales, or a hand-added Pre-sales / Bid / Legal member) but not yet in the company
 *  org. Read-only here; "Add to employees" creates their org record prefilled. */
export function OtherEmployeeRow({ employee: e, canEdit, pending, onAdd }: {
  employee: MasterEmployee
  canEdit: boolean
  pending: boolean
  onAdd: (employee: MasterEmployee) => void
}) {
  return (
    <tr className={cn('bg-panel/40 hover:bg-grid-hover', e.status === 'inactive' && 'opacity-60')}>
      <td className={CELL}>
        <div className="flex items-center gap-2">
          <PersonName person={e} size="sm" nameClassName="font-medium text-ink-900" />
          <SourceBadges sources={e.sources} />
        </div>
      </td>
      <td className={CELL}><span className="text-muted">{e.email || '—'}</span></td>
      <td className={cn(CELL, 'text-muted')}>—</td>
      <td className={cn(CELL, 'text-ink-700')}>{e.designation || <span className="text-muted">—</span>}</td>
      <td className={cn(CELL, 'text-[12px] text-muted')}>Not in the org yet</td>
      <td className={cn(CELL, 'text-[12px] text-ink-700')}>{e.departments.join(', ') || '—'}</td>
      <td className={cn(CELL, 'text-right')}>
        <Button
          variant="secondary" size="sm" disabled={!canEdit || pending} title={canEdit ? 'Create their employee record, prefilled' : NO_PERMISSION_TITLE}
          aria-label={`Add ${e.name} to employees`} onClick={() => onAdd(e)}
        >
          <Icon name="UserPlus" size={13} /> Add to employees
        </Button>
      </td>
    </tr>
  )
}
