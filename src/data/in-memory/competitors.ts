// Competitors in local (no API) mode: pure functions over the stored array, so every change returns a new list and
// the repository just swaps it in. The same domain rules as the API router validate every write.
import { assertUniqueCompetitorName, normalizeCompetitorInput, type Competitor, type CompetitorInput } from '@goms/domain'
import { uid } from '@/lib/utils'

/** A copy that shares no arrays with the store, so callers can never mutate stored data. */
export function cloneCompetitor(item: Competitor): Competitor {
  return {
    ...item, subCategories: [...(item.subCategories ?? [])], verticals: [...(item.verticals ?? [])],
    certifications: [...(item.certifications ?? [])], offerings: [...(item.offerings ?? [])], strengths: [...(item.strengths ?? [])],
    relationship: item.relationship ?? 'competitor', category: item.category ?? '',
  }
}

export function listCompetitorsLocal(items: readonly Competitor[]): Competitor[] {
  return [...items].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })).map(cloneCompetitor)
}

export function createCompetitorLocal(items: readonly Competitor[], input: CompetitorInput): { items: Competitor[]; created: Competitor } {
  const clean = normalizeCompetitorInput(input)
  assertUniqueCompetitorName(items, clean.name)
  const now = new Date().toISOString()
  const created: Competitor = { id: uid('cmp'), ...clean, createdAt: now, updatedAt: now }
  return { items: [...items, created], created }
}

export function updateCompetitorLocal(items: readonly Competitor[], id: string, input: CompetitorInput): { items: Competitor[]; updated: Competitor } {
  const existing = items.find(item => item.id === id)
  if (!existing) throw new Error('That competitor no longer exists.')
  const clean = normalizeCompetitorInput(input)
  assertUniqueCompetitorName(items, clean.name, id)
  const updated: Competitor = { ...existing, ...clean, updatedAt: new Date().toISOString() }
  return { items: items.map(item => (item.id === id ? updated : item)), updated }
}

export function deleteCompetitorLocal(items: readonly Competitor[], id: string): Competitor[] {
  if (!items.some(item => item.id === id)) throw new Error('That competitor no longer exists.')
  return items.filter(item => item.id !== id)
}
