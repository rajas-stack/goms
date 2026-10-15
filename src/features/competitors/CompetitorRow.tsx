import type { Competitor } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { toLocalIsoDate } from '@/lib/dates'
import { formatFriendlyValue } from '@/lib/friendlyDate'
import { CompetitorLogo } from './CompetitorLogo'
import { RelationshipPill } from './RelationshipPill'
import { TagChips } from './TagChips'

/** Shared by the header row and every data row, so the columns line up (wide screens only). */
export const ROW_GRID = 'lg:grid lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1.15fr)_minmax(0,1.2fr)_minmax(0,1.9fr)_minmax(0,1.8fr)_minmax(0,0.85fr)_8.75rem] lg:items-start lg:gap-4'

export function formatUpdated(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : formatFriendlyValue(toLocalIsoDate(date), 'date')
}

/** Column label shown above each cell only when rows collapse into stacked cards. */
function CellLabel({ children }: { children: string }) {
  return <p className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-muted lg:hidden">{children}</p>
}

/** One competitor as a table-like row card; stacks into a card below the `lg` breakpoint. */
export function CompetitorRow({ competitor, onView }: { competitor: Competitor; onView: () => void }) {
  const { name, logo, description, relationship, category, subCategories, offerings, strengths, updatedAt } = competitor
  return (
    // The whole card opens the details (mouse); the View Details button stays the keyboard/screen-reader control.
    // A click that ends a text selection is ignored so names and strengths can still be copied.
    <article aria-label={name} onClick={() => { if (!window.getSelection()?.toString()) onView() }}
      className={`${ROW_GRID} grid cursor-pointer grid-cols-1 gap-3 rounded-2xl border border-line bg-white p-4 shadow-sm transition-[border-color,box-shadow] duration-150 hover:border-ink-600/40 hover:shadow-md sm:grid-cols-2`}>
      <div className="flex min-w-0 gap-3 sm:col-span-2 lg:col-span-1">
        <CompetitorLogo name={name} logo={logo} variant="wordmark" />
        <div className="min-w-0">
          <h2 className="truncate text-[14.5px] font-semibold text-ink-900">{name}</h2>
          {description && <p className="mt-0.5 line-clamp-3 text-[12.5px] leading-snug text-muted">{description}</p>}
        </div>
      </div>
      <div><CellLabel>Relationship Status</CellLabel><RelationshipPill relationship={relationship} /></div>
      <div className="min-w-0">
        <CellLabel>Industry / Category</CellLabel>
        <p className="text-[13px] font-semibold text-ink-900">{category || '—'}</p>
        {subCategories.length > 0 && <p className="mt-0.5 text-[12px] leading-snug text-muted">{subCategories.join(', ')}</p>}
      </div>
      <div className="min-w-0"><CellLabel>Offerings</CellLabel><TagChips tags={offerings} label={`${name} offerings`} max={6} /></div>
      <div className="min-w-0">
        <CellLabel>Key Strengths</CellLabel>
        {strengths.length ? (
          <ul aria-label={`${name} strengths`} className="space-y-1">
            {strengths.slice(0, 3).map(item => (
              <li key={item} className="flex gap-1.5 text-[12.5px] leading-snug text-ink-800">
                <span aria-hidden="true" className="mt-[7px] h-1 w-1 shrink-0 rounded-full bg-goms-navy" /><span className="line-clamp-2">{item}</span>
              </li>
            ))}
          </ul>
        ) : <span className="text-[12px] text-muted">—</span>}
      </div>
      <div><CellLabel>Last Updated</CellLabel><p className="whitespace-nowrap text-[12.5px] text-ink-800">{formatUpdated(updatedAt)}</p></div>
      <div className="sm:col-span-2 lg:col-span-1">
        <Button size="sm" aria-label={`View details for ${name}`} className="w-full whitespace-nowrap" onClick={event => { event.stopPropagation(); onView() }}>
          View Details <Icon name="ArrowRight" size={13} />
        </Button>
      </div>
    </article>
  )
}
