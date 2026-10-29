import { describe, expect, it } from 'vitest'
import { matchSaved, savedFor, withStar } from './savedPlaces'

const home = { name: 'Orchid Greenfield Applewood', address: 'Applewood Township, Ahmedabad', lat: 23.0, lng: 72.5, placeId: 'p-home' }
const office = { name: 'Statesman House', address: 'Barakhamba Road, New Delhi', placeId: 'p-delhi' }

describe('starred places', () => {
  const saved = withStar(withStar([], 'Home', home), 'Delhi office', office)

  it('finds a starred place by its short name, full name or address; lists all when nothing is typed', () => {
    expect(matchSaved(saved, 'home').map((s) => s.short)).toEqual(['Home'])
    expect(matchSaved(saved, 'delhi').map((s) => s.short)).toEqual(['Delhi office'])
    expect(matchSaved(saved, 'applewood').map((s) => s.short)).toEqual(['Home'])
    expect(matchSaved(saved, '').map((s) => s.short)).toEqual(['Delhi office', 'Home'])
  })

  it('recognises a place by Google place, location or short name', () => {
    expect(savedFor(saved, { name: 'whatever', placeId: 'p-home' })?.short).toBe('Home')
    expect(savedFor(saved, { name: 'x', lat: 23.0, lng: 72.5 })?.short).toBe('Home')
    expect(savedFor(saved, { name: 'delhi office' })?.short).toBe('Delhi office')
    expect(savedFor(saved, { name: 'Somewhere else' })).toBeUndefined()
  })

  it('renames instead of duplicating, and keeps one place per short name', () => {
    const renamed = withStar(saved, 'My home', home)
    expect(renamed.map((s) => s.short)).toEqual(['Delhi office', 'My home'])
    expect(withStar(saved, 'Home', office).map((s) => s.short)).toEqual(['Home'])
    expect(withStar(saved, '   ', home)).toEqual(saved)
  })
})
