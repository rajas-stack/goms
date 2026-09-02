import { describe, expect, it } from 'vitest'
import { citiesForDistrict, stdCodeForCity, STD_CODE_ENTRIES } from './std-codes'

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
    expect(citiesForDistrict(386)).toEqual([{ districtLgdCode: 386, city: 'Bhubaneswar', stdCode: '0674' }])
  })

  it('the seed dataset is a small sample, not a full authoritative table', () => {
    expect(STD_CODE_ENTRIES.length).toBeGreaterThan(0)
  })
})
