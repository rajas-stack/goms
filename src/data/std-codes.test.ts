import { describe, expect, it } from 'vitest'
import { citiesForDistrict, citiesInState, stdCodeForCity, STD_CODE_ENTRIES } from './std-codes'

describe('std-codes', () => {
  it('stdCodeForCity returns the correct code for the seeded Bhubaneswar/Odisha example', () => {
    expect(stdCodeForCity(386, 'Bhubaneswar')).toBe('0674')
  })

  it('stdCodeForCity returns undefined for a city not in the seed data', () => {
    expect(stdCodeForCity(386, 'Nowhereville')).toBeUndefined()
    expect(stdCodeForCity(999, 'Bhubaneswar')).toBeUndefined()
  })

  it('citiesForDistrict returns an empty array (not an error) for a district with no seeded cities yet', () => {
    expect(citiesForDistrict(1)).toEqual([])
  })

  it('citiesForDistrict returns the seeded entries for a district that has them', () => {
    const entries = citiesForDistrict(386)
    expect(entries.find((e) => e.city === 'Bhubaneswar')).toMatchObject({ districtLgdCode: 386, city: 'Bhubaneswar', stdCode: '0674' })
    expect(stdCodeForCity(386, 'Bhubaneswar')).toBe('0674')
  })

  it('the seed dataset is a small, partial, honestly-provenanced sample, not a full authoritative table', () => {
    expect(STD_CODE_ENTRIES.length).toBeGreaterThan(0)
    for (const entry of STD_CODE_ENTRIES) {
      expect(entry.source).toBeTruthy()
      expect(['verified', 'cross-walked', 'secondary']).toContain(entry.verificationLevel)
    }
  })

  it('stdCodeForCity resolves a cross-walked, non-namesake city (Vijayawada -> Krishna district)', () => {
    expect(stdCodeForCity(547, 'Vijayawada')).toBe('0866')
  })

  it('citiesForDistrict returns multiple SDCAs for a district with more than one seeded city', () => {
    const entries = citiesForDistrict(595) // Ernakulam, Kerala
    expect(entries.map((e) => e.city).sort()).toEqual(['Kochi', 'Muvattupuzha'])
  })

  it('has no duplicate (districtLgdCode, city) rows', () => {
    const keys = STD_CODE_ENTRIES.map((e) => `${e.districtLgdCode}::${e.city}`)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('stdCodeForCity resolves the same city under two districts it legitimately spans (Imphal)', () => {
    expect(stdCodeForCity(277, 'Imphal')).toBe('0385') // Imphal West
    expect(stdCodeForCity(278, 'Imphal')).toBe('0385') // Imphal East
  })

  it('Gandhinagar is verified against an official source, not the Antigravity-research value it contradicted', () => {
    const entry = citiesForDistrict(473).find((e) => e.city === 'Gandhinagar')
    expect(entry?.stdCode).toBe('079')
    expect(entry?.verificationLevel).toBe('verified')
  })

  describe('citiesInState', () => {
    it('returns every seeded entry for a real state, spanning multiple districts', () => {
      const entries = citiesInState('Odisha')
      expect(entries.length).toBeGreaterThan(1)
      expect(entries.every((e) => e.state === 'Odisha')).toBe(true)
      expect(entries.find((e) => e.city === 'Bhubaneswar')).toMatchObject({ districtLgdCode: 386, stdCode: '0674' })
    })

    it('returns an empty array (not an error) for a state with no seeded cities', () => {
      expect(citiesInState('Nowhereland')).toEqual([])
    })

    it('matches the state name exactly — no partial/fuzzy matching', () => {
      expect(citiesInState('Odis')).toEqual([])
      expect(citiesInState('odisha')).toEqual([])
    })

    it('never mixes another state\'s entries into the result', () => {
      const odisha = citiesInState('Odisha')
      const kerala = citiesInState('Kerala')
      expect(odisha.some((e) => e.city === 'Kochi')).toBe(false)
      expect(kerala.some((e) => e.city === 'Bhubaneswar')).toBe(false)
    })
  })
})
