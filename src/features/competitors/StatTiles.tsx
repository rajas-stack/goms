import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'
import type { CompetitorStats } from './model'

interface Tile { label: string; value: number; subline: string; icon: string; tone: string }

function categoriesLine(categories: readonly string[]): string {
  if (!categories.length) return 'No categories yet'
  const head = categories.slice(0, 3).join(', ')
  return categories.length > 3 ? `${head} +${categories.length - 3}` : head
}

/** The four summary tiles above the filters. */
export function StatTiles({ stats }: { stats: CompetitorStats }) {
  const tiles: Tile[] = [
    { label: 'Total Competitors', value: stats.total, icon: 'Building2', tone: 'bg-blue-100 text-blue-700',
      subline: stats.addedLast90Days ? `+${stats.addedLast90Days} added in the last 90 days` : 'None added in the last 90 days' },
    { label: 'Key Categories', value: stats.categories.length, icon: 'Layers', tone: 'bg-purple-100 text-purple-600',
      subline: categoriesLine(stats.categories) },
    { label: 'Strategic Threats', value: stats.strategicThreats, icon: 'ShieldAlert', tone: 'bg-crimson-100 text-crimson',
      subline: 'High priority competitors' },
    { label: 'Recently Updated', value: stats.updatedLast30Days, icon: 'History', tone: 'bg-emerald-100 text-emerald-700',
      subline: 'In the last 30 days' },
  ]
  return (
    <ul aria-label="Competitor summary" className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {tiles.map(tile => (
        <li key={tile.label} aria-label={`${tile.label}: ${tile.value}`}
          className="flex min-w-0 items-start gap-3 rounded-2xl border border-line bg-white p-3.5 shadow-sm sm:p-4">
          <span className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', tile.tone)}><Icon name={tile.icon} size={19} /></span>
          <div className="min-w-0">
            <p className="text-[12px] font-medium text-muted">{tile.label}</p>
            <p className="mt-0.5 text-2xl font-semibold leading-tight tabular-nums text-ink-900">{tile.value}</p>
            <p className="mt-0.5 truncate text-[11.5px] text-muted" title={tile.subline}>{tile.subline}</p>
          </div>
        </li>
      ))}
    </ul>
  )
}
