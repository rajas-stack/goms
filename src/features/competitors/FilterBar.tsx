import { COMPETITOR_RELATIONSHIPS, COMPETITOR_RELATIONSHIP_LABEL } from '@goms/domain'
import { Icon } from '@/components/ui/Icon'
import { FilterDropdown, type FilterOption } from './FilterDropdown'
import { activeFilterCount, EMPTY_FILTERS, type CompetitorFilters, type FilterDimension } from './model'

interface Props {
  filters: CompetitorFilters
  options: Record<Exclude<FilterDimension, 'relationships'>, string[]>
  onChange: (next: CompetitorFilters) => void
}

const RELATIONSHIP_OPTIONS: FilterOption[] = COMPETITOR_RELATIONSHIPS.map(value => ({ value, label: COMPETITOR_RELATIONSHIP_LABEL[value] }))
const asOptions = (values: readonly string[]): FilterOption[] => values.map(value => ({ value, label: value }))

/** Vertical / Relationship / Certifications / Capabilities dropdowns with the active count and "Clear all". */
export function FilterBar({ filters, options, onChange }: Props) {
  const count = activeFilterCount(filters)
  const set = (dimension: FilterDimension) => (next: string[]) => onChange({ ...filters, [dimension]: next })
  return (
    <div role="toolbar" aria-label="Filters" className="flex flex-wrap items-center gap-2">
      <span className="mr-1 inline-flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
        <Icon name="SlidersHorizontal" size={13} /> Filters
      </span>
      <FilterDropdown label="Vertical" options={asOptions(options.verticals)} value={filters.verticals} onChange={set('verticals')} />
      <FilterDropdown label="Relationship Status" options={RELATIONSHIP_OPTIONS} value={filters.relationships} onChange={set('relationships')} />
      <FilterDropdown label="Certifications" options={asOptions(options.certifications)} value={filters.certifications} onChange={set('certifications')} />
      <FilterDropdown label="Capabilities / Offerings" options={asOptions(options.offerings)} value={filters.offerings} onChange={set('offerings')} />
      {count > 0 && (
        <div className="ml-auto flex items-center gap-3 text-[12.5px]">
          <span className="text-muted">{count} active filter{count === 1 ? '' : 's'}</span>
          <button type="button" onClick={() => onChange(EMPTY_FILTERS)}
            className="inline-flex items-center gap-1 rounded font-medium text-goms-navy hover:underline focus-visible:focus-ring">
            <Icon name="X" size={12} /> Clear all
          </button>
        </div>
      )}
    </div>
  )
}
