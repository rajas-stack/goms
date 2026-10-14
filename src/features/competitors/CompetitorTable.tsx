import type { Competitor } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import { CompetitorRow, ROW_GRID } from './CompetitorRow'
import type { SortKey, SortState } from './model'

interface Props {
  items: readonly Competitor[]
  sort: SortState
  onSort: (key: SortKey) => void
  onView: (competitor: Competitor) => void
}

function SortHeader({ label, sortKey, sort, onSort }: { label: string; sortKey: SortKey; sort: SortState; onSort: (key: SortKey) => void }) {
  const active = sort.key === sortKey
  return (
    <div>
      <button type="button" onClick={() => onSort(sortKey)} aria-label={`Sort by ${label}`} aria-pressed={active}
        title={active ? `Sorted ${sort.direction === 'asc' ? 'ascending' : 'descending'}` : undefined}
        className={cn('inline-flex items-center gap-1 rounded text-left uppercase leading-tight tracking-wide hover:text-ink focus-visible:focus-ring', active && 'text-goms-navy')}>
        {label}
        <Icon name={active ? (sort.direction === 'asc' ? 'ArrowUp' : 'ArrowDown') : 'ChevronsUpDown'} size={12} />
      </button>
    </div>
  )
}

const plain = (label: string) => <div>{label}</div>

/** Column headers (wide screens) over the competitor row cards. */
export function CompetitorTable({ items, sort, onSort, onView }: Props) {
  return (
    <div className="space-y-2.5">
      <div className={cn(ROW_GRID, 'hidden lg:!items-end border border-transparent px-4 pb-1 text-left text-[11px] font-semibold uppercase leading-tight tracking-wide text-muted')}>
        <SortHeader label="Company" sortKey="name" sort={sort} onSort={onSort} />
        <SortHeader label="Relationship Status" sortKey="relationship" sort={sort} onSort={onSort} />
        {plain('Industry / Category')}
        {plain('Offerings')}
        {plain('Key Strengths')}
        <SortHeader label="Last Updated" sortKey="updatedAt" sort={sort} onSort={onSort} />
        <div />
      </div>
      <MobileSort sort={sort} onSort={onSort} />
      <ul aria-label="Saved competitors" className="space-y-2.5">
        {items.map(item => <li key={item.id}><CompetitorRow competitor={item} onView={() => onView(item)} /></li>)}
      </ul>
    </div>
  )
}

const SORT_CHOICES: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Company' }, { key: 'relationship', label: 'Relationship' }, { key: 'updatedAt', label: 'Last updated' },
]

/** Below `lg` the column headers are hidden, so sorting moves to compact chips. */
function MobileSort({ sort, onSort }: { sort: SortState; onSort: (key: SortKey) => void }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-2 lg:hidden">
      {SORT_CHOICES.map(choice => {
        const active = sort.key === choice.key
        return (
          <button key={choice.key} type="button" onClick={() => onSort(choice.key)} aria-label={`Sort cards by ${choice.label}`}
            className={cn('inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[12px] font-medium',
              active ? 'border-goms-navy/40 bg-goms-navy/10 text-goms-navy' : 'border-line bg-white text-muted')}>
            {choice.label}{active && <Icon name={sort.direction === 'asc' ? 'ArrowUp' : 'ArrowDown'} size={11} />}
          </button>
        )
      })}
    </div>
  )
}
