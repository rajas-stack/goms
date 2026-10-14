import { describe, expect, it } from 'vitest'
import type { Competitor } from '@goms/domain'
import { activeFilterCount, applyFilters, computeStats, EMPTY_FILTERS, filterOptions, nextSort, sortCompetitors, tagTone, TAG_TONES } from './model'

const make = (patch: Partial<Competitor> & { name: string }): Competitor => ({
  id: patch.name, logo: null, website: null, relationship: 'competitor', category: '', subCategories: [], verticals: [],
  certifications: [], offerings: [], strengths: [], description: '', createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
  ...patch,
})

const NOW = new Date('2026-10-13T00:00:00.000Z')
const items = [
  make({ name: 'SAS', relationship: 'strategicThreat', category: 'Analytics', verticals: ['BFSI'], offerings: ['MDM'], createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z' }),
  make({ name: 'IBM', relationship: 'partner', category: 'IT Services', verticals: ['bfsi', 'Government'], certifications: ['CMMI L5'] }),
  make({ name: 'Oracle', category: 'Analytics', offerings: ['Database'] }),
]

describe('competitor view model', () => {
  it('computes stats from dates, categories and relationships', () => {
    expect(computeStats(items, NOW)).toEqual({ total: 3, addedLast90Days: 1, categories: ['Analytics', 'IT Services'], strategicThreats: 1, updatedLast30Days: 1 })
  })

  it('builds de-duplicated filter options', () => {
    expect(filterOptions(items)).toEqual({ verticals: ['BFSI', 'Government'], certifications: ['CMMI L5'], offerings: ['Database', 'MDM'] })
  })

  it('ANDs dimensions and ORs values within one, ignoring case', () => {
    expect(applyFilters(items, '', { ...EMPTY_FILTERS, verticals: ['BFSI'] }).map(i => i.name)).toEqual(['SAS', 'IBM'])
    expect(applyFilters(items, '', { ...EMPTY_FILTERS, verticals: ['BFSI'], relationships: ['partner'] }).map(i => i.name)).toEqual(['IBM'])
    expect(applyFilters(items, 'analytics', EMPTY_FILTERS).map(i => i.name)).toEqual(['SAS', 'Oracle'])
    expect(activeFilterCount({ ...EMPTY_FILTERS, verticals: ['BFSI'], offerings: ['MDM', 'Database'] })).toBe(2)
  })

  it('sorts by name, relationship (threats first) and last updated', () => {
    expect(sortCompetitors(items, { key: 'name', direction: 'asc' }).map(i => i.name)).toEqual(['IBM', 'Oracle', 'SAS'])
    expect(sortCompetitors(items, { key: 'relationship', direction: 'asc' }).map(i => i.name)).toEqual(['SAS', 'Oracle', 'IBM'])
    expect(sortCompetitors(items, { key: 'updatedAt', direction: 'desc' }).map(i => i.name)[0]).toBe('SAS')
    expect(nextSort({ key: 'name', direction: 'asc' }, 'name')).toEqual({ key: 'name', direction: 'desc' })
    expect(nextSort({ key: 'name', direction: 'asc' }, 'updatedAt')).toEqual({ key: 'updatedAt', direction: 'desc' })
  })

  it('gives each tag a stable theme tone', () => {
    expect(tagTone('Master data management')).toBe(tagTone('master data management'))
    expect(TAG_TONES).toContain(tagTone('Anything'))
  })
})
