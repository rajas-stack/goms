// Pure view logic for the Competitors page: filter options, filtering, sorting and the stat tiles.
import { competitorMatches, type Competitor, type CompetitorRelationship } from '@goms/domain'

/** The four filter dimensions, each a multi-select. */
export const FILTER_DIMENSIONS = ['verticals', 'relationships', 'certifications', 'offerings'] as const
export type FilterDimension = typeof FILTER_DIMENSIONS[number]
export type CompetitorFilters = Record<FilterDimension, string[]>

export const EMPTY_FILTERS: CompetitorFilters = { verticals: [], relationships: [], certifications: [], offerings: [] }

export const FILTER_LABEL: Record<FilterDimension, string> = {
  verticals: 'Vertical',
  relationships: 'Relationship',
  certifications: 'Certifications',
  offerings: 'Capabilities',
}

export type SortKey = 'name' | 'relationship' | 'updatedAt'
export interface SortState { key: SortKey; direction: 'asc' | 'desc' }
export const DEFAULT_SORT: SortState = { key: 'name', direction: 'asc' }

const DAY_MS = 24 * 60 * 60 * 1000

/** Distinct values (first spelling wins, case-insensitive), sorted alphabetically. */
function distinct(values: readonly string[]): string[] {
  const seen = new Map<string, string>()
  values.forEach(value => { if (value && !seen.has(value.toLowerCase())) seen.set(value.toLowerCase(), value) })
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
}

/** Options for each tag dropdown, taken from saved competitors. Relationships use their keys. */
export function filterOptions(items: readonly Competitor[]): Record<Exclude<FilterDimension, 'relationships'>, string[]> {
  return {
    verticals: distinct(items.flatMap(item => item.verticals)),
    certifications: distinct(items.flatMap(item => item.certifications)),
    offerings: distinct(items.flatMap(item => item.offerings)),
  }
}

const hasAny = (values: readonly string[], wanted: readonly string[]) => {
  const set = new Set(values.map(value => value.toLowerCase()))
  return wanted.some(value => set.has(value.toLowerCase()))
}

/** Search (name, category, offerings) AND every active dimension (any of its selected values). */
export function applyFilters(items: readonly Competitor[], query: string, filters: CompetitorFilters): Competitor[] {
  return items.filter(item => competitorMatches(item, query)
    && (!filters.verticals.length || hasAny(item.verticals, filters.verticals))
    && (!filters.relationships.length || filters.relationships.includes(item.relationship))
    && (!filters.certifications.length || hasAny(item.certifications, filters.certifications))
    && (!filters.offerings.length || hasAny(item.offerings, filters.offerings)))
}

export function activeFilterCount(filters: CompetitorFilters): number {
  return FILTER_DIMENSIONS.filter(dimension => filters[dimension].length > 0).length
}

/** Threats first when sorting by relationship ascending. */
const RELATIONSHIP_ORDER: Record<CompetitorRelationship, number> = { strategicThreat: 0, competitor: 1, neutral: 2, partner: 3 }

export function sortCompetitors(items: readonly Competitor[], sort: SortState): Competitor[] {
  const byName = (a: Competitor, b: Competitor) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  const compare = (a: Competitor, b: Competitor): number => {
    if (sort.key === 'relationship') return RELATIONSHIP_ORDER[a.relationship] - RELATIONSHIP_ORDER[b.relationship] || byName(a, b)
    if (sort.key === 'updatedAt') return a.updatedAt.localeCompare(b.updatedAt) || byName(a, b)
    return byName(a, b)
  }
  const sign = sort.direction === 'asc' ? 1 : -1
  return [...items].sort((a, b) => sign * compare(a, b))
}

/** Clicking the active column flips its direction; another column starts ascending (newest first for dates). */
export function nextSort(current: SortState, key: SortKey): SortState {
  if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' }
  return { key, direction: key === 'updatedAt' ? 'desc' : 'asc' }
}

export interface CompetitorStats {
  total: number
  addedLast90Days: number
  categories: string[]
  strategicThreats: number
  updatedLast30Days: number
}

export function computeStats(items: readonly Competitor[], now: Date = new Date()): CompetitorStats {
  const since = (days: number) => now.getTime() - days * DAY_MS
  const after = (iso: string, days: number) => new Date(iso).getTime() >= since(days)
  return {
    total: items.length,
    addedLast90Days: items.filter(item => after(item.createdAt, 90)).length,
    categories: distinct(items.map(item => item.category)),
    strategicThreats: items.filter(item => item.relationship === 'strategicThreat').length,
    updatedLast30Days: items.filter(item => after(item.updatedAt, 30)).length,
  }
}

/** Theme tones for tag chips; each tag keeps its colour wherever it appears. */
export const TAG_TONES = [
  'bg-blue-100 text-blue-700',
  'bg-emerald-100 text-emerald-700',
  'bg-amber-100 text-amber-800',
  'bg-purple-100 text-purple-600',
  'bg-teal-100 text-teal-700',
  'bg-indigo-100 text-indigo-600',
] as const

export function tagTone(tag: string): string {
  let hash = 0
  for (const char of tag.toLowerCase()) hash = (hash * 31 + char.charCodeAt(0)) >>> 0
  return TAG_TONES[hash % TAG_TONES.length]
}
