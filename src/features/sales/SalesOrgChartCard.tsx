import { forwardRef } from 'react'
import { Avatar } from '@/components/ui/Avatar'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { cn } from '@/lib/utils'
import { STATUS_LABEL, STATUS_STYLE } from '@/data/sales-status'
import type { SalesPerson, SalesPosting } from '@/lib/types'

export const SalesOrgChartCard = forwardRef<HTMLDivElement, {
  person: SalesPerson
  posting: SalesPosting | undefined
  flagged: boolean
  selected: boolean
  expanded: boolean
  canExpand: boolean
  directReportCount: number
  onSelect: () => void
  onToggle: () => void
}>(({ person, posting, flagged, selected, expanded, canExpand, directReportCount, onSelect, onToggle }, ref) => (
  <div
    ref={ref}
    data-canvas-card
    data-testid={`sales-org-chart-card-${person.id}`}
    onClick={onSelect}
    className={cn(
      'relative flex w-[220px] cursor-pointer flex-col items-center gap-2 rounded-card border bg-white px-3.5 py-3 text-center shadow-panel transition-colors',
      selected ? 'border-ink-900/30 ring-2 ring-ink-900/10' : 'border-line hover:border-ink-600/40',
      flagged && 'border-dashed border-amber',
    )}
  >
    <Avatar person={{ name: person.name, photoUrl: undefined }} size="md" />
    <div className="min-w-0">
      <div className="truncate text-[13px] font-semibold text-ink-900">{person.name}</div>
      <div className="truncate text-[11px] text-muted">{posting?.designation || '—'}</div>
      {person.officialEmail && (
        <div className="truncate text-[10px] text-muted/80">{person.officialEmail}</div>
      )}
    </div>
    <span className={cn('rounded-full px-1.5 py-0.5 text-[10px] font-medium', STATUS_STYLE[person.status])}>
      {STATUS_LABEL[person.status] ?? person.status}
    </span>
    {flagged && (
      <Tooltip label="This person's reporting-manager reference is broken or circular — shown as a root rather than guessing a parent.">
        <span className="absolute -right-2 -top-2 flex h-5 w-5 items-center justify-center rounded-full bg-amber-100 text-amber-700">
          <Icon name="CircleAlert" size={11} />
        </span>
      </Tooltip>
    )}
    {canExpand && (
      <Tooltip label={expanded ? 'Collapse' : `Show ${directReportCount} direct report${directReportCount === 1 ? '' : 's'}`}>
        <button
          onClick={(e) => { e.stopPropagation(); onToggle() }}
          aria-label={expanded ? 'Collapse' : 'Expand'}
          data-testid={`sales-org-chart-toggle-${person.id}`}
          className={cn(
            'absolute -bottom-3 left-1/2 flex h-6 w-6 -translate-x-1/2 items-center justify-center rounded-full border bg-white text-muted shadow-sm hover:border-ink-600 hover:text-ink-900',
            expanded && 'border-ink-600 text-ink-900',
          )}
        >
          <Icon name={expanded ? 'ChevronUp' : 'ChevronDown'} size={13} />
        </button>
      </Tooltip>
    )}
  </div>
))
SalesOrgChartCard.displayName = 'SalesOrgChartCard'
