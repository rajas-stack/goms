// Named filter sets for the Competitors page, kept per browser in localStorage. A convenience only: storage can be
// blocked or cleared, so every read and write is guarded and the page works without it.
import { FILTER_DIMENSIONS, type CompetitorFilters } from './model'

export interface SavedFilterSet { name: string; filters: CompetitorFilters }

const KEY = 'goms.competitors.filterSets'
const MAX_SETS = 20

function isFilters(value: unknown): value is CompetitorFilters {
  if (!value || typeof value !== 'object') return false
  return FILTER_DIMENSIONS.every(dimension => {
    const list = (value as Record<string, unknown>)[dimension]
    return Array.isArray(list) && list.every(item => typeof item === 'string')
  })
}

export function loadFilterSets(): SavedFilterSet[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is SavedFilterSet =>
      !!item && typeof item.name === 'string' && item.name.trim() !== '' && isFilters(item.filters))
  } catch {
    return []
  }
}

/** Saves (or replaces, by name ignoring case) a set; returns the new list, or null when storage is unavailable. */
export function saveFilterSet(current: readonly SavedFilterSet[], name: string, filters: CompetitorFilters): SavedFilterSet[] | null {
  const label = name.trim().slice(0, 60)
  if (!label) return null
  const next = [{ name: label, filters }, ...current.filter(set => set.name.toLowerCase() !== label.toLowerCase())].slice(0, MAX_SETS)
  return writeSets(next)
}

export function deleteFilterSet(current: readonly SavedFilterSet[], name: string): SavedFilterSet[] | null {
  return writeSets(current.filter(set => set.name !== name))
}

function writeSets(sets: SavedFilterSet[]): SavedFilterSet[] | null {
  try {
    localStorage.setItem(KEY, JSON.stringify(sets))
    return sets
  } catch {
    return null
  }
}
