import { describe, expect, it } from 'vitest'
import {
  addOfferings, assertUniqueCompetitorName, COMPETITOR_LIMITS, competitorInitials, competitorMatches,
  logoDataUrlBytes, normalizeCompetitorInput, normalizeCompetitorLogo, normalizeCompetitorWebsite,
} from './index.js'

const dataUrl = (type: string, bytes: number) => `data:${type};base64,${Buffer.alloc(bytes, 1).toString('base64')}`

describe('normalizeCompetitorInput', () => {
  it('trims fields and fills defaults', () => {
    expect(normalizeCompetitorInput({ name: '  SAS  Institute ', description: ' notes ' })).toEqual({
      name: 'SAS Institute', logo: null, website: null, relationship: 'competitor', category: '',
      subCategories: [], verticals: [], certifications: [], offerings: [], strengths: [], description: 'notes',
    })
  })

  it('validates relationship, category and every tag list with its own limits', () => {
    const clean = normalizeCompetitorInput({
      name: 'SAS', relationship: 'strategicThreat', category: ' Data  Management ',
      verticals: ['BFSI', 'bfsi', 'Government'], certifications: ['ISO 27001'], strengths: ['Deep analytics heritage'],
    })
    expect(clean).toMatchObject({ relationship: 'strategicThreat', category: 'Data Management', verticals: ['BFSI', 'Government'] })
    expect(() => normalizeCompetitorInput({ name: 'SAS', relationship: 'enemy' as never })).toThrow(/relationship/)
    expect(() => normalizeCompetitorInput({ name: 'SAS', category: 'x'.repeat(81) })).toThrow(/category/)
    expect(() => normalizeCompetitorInput({ name: 'SAS', subCategories: Array.from({ length: 11 }, (_, i) => `s${i}`) })).toThrow(/at most 10 sub-categories/)
    expect(() => normalizeCompetitorInput({ name: 'SAS', strengths: ['x'.repeat(201)] })).toThrow(/strength under 200/)
    expect(normalizeCompetitorInput({ name: 'SAS', strengths: ['x'.repeat(200)] }).strengths).toHaveLength(1)
  })

  it('rejects a blank or over-long name and over-long notes', () => {
    expect(() => normalizeCompetitorInput({ name: '   ' })).toThrow(/name/)
    expect(() => normalizeCompetitorInput({ name: 'x'.repeat(COMPETITOR_LIMITS.name + 1) })).toThrow(/under 120/)
    expect(() => normalizeCompetitorInput({ name: 'SAS', description: 'x'.repeat(2001) })).toThrow(/notes/)
  })

  it('dedupes offerings ignoring case and enforces the tag limits', () => {
    expect(normalizeCompetitorInput({ name: 'SAS', offerings: ['MDM', ' mdm ', '', 'Data  quality'] }).offerings).toEqual(['MDM', 'Data quality'])
    expect(() => addOfferings([], ['x'.repeat(61)])).toThrow(/60 characters/)
    const full = Array.from({ length: 30 }, (_, i) => `tag ${i}`)
    expect(() => addOfferings(full, ['one more'])).toThrow(/at most 30/)
    expect(addOfferings(full, ['TAG 1'])).toHaveLength(30)
  })
})

describe('competitor links and logos', () => {
  it('adds https:// to a bare domain and refuses non-https websites', () => {
    expect(normalizeCompetitorWebsite('sas.com')).toBe('https://sas.com')
    expect(normalizeCompetitorWebsite(' ')).toBeNull()
    expect(() => normalizeCompetitorWebsite('http://sas.com')).toThrow(/https/)
    expect(() => normalizeCompetitorWebsite('javascript:alert(1)')).toThrow(/https/)
  })

  it('accepts image data URLs up to 256 KB and https logo links', () => {
    const ok = dataUrl('image/png', COMPETITOR_LIMITS.logoBytes)
    expect(logoDataUrlBytes(ok)).toBe(COMPETITOR_LIMITS.logoBytes)
    expect(normalizeCompetitorLogo(ok)).toBe(ok)
    expect(normalizeCompetitorLogo(dataUrl('image/svg+xml', 10))).toMatch(/^data:image\/svg\+xml/)
    expect(normalizeCompetitorLogo('https://cdn.example.com/sas.png')).toBe('https://cdn.example.com/sas.png')
    expect(() => normalizeCompetitorLogo(dataUrl('image/png', COMPETITOR_LIMITS.logoBytes + 1))).toThrow(/256 KB/)
    expect(() => normalizeCompetitorLogo(dataUrl('image/gif', 10))).toThrow(/PNG, JPG, SVG or WebP/)
    expect(() => normalizeCompetitorLogo('http://cdn.example.com/sas.png')).toThrow(/https/)
  })
})

describe('competitor helpers', () => {
  it('requires unique names ignoring case, except for the record itself', () => {
    const existing = [{ id: 'a', name: 'SAS' }]
    expect(() => assertUniqueCompetitorName(existing, ' sas ')).toThrow(/already exists/)
    expect(() => assertUniqueCompetitorName(existing, 'SAS', 'a')).not.toThrow()
  })

  it('builds initials and matches search on name or offering', () => {
    expect(competitorInitials('SAS')).toBe('SA')
    expect(competitorInitials('Tata Consultancy Services')).toBe('TC')
    const sas = { name: 'SAS', offerings: ['Master data management'] }
    expect(competitorMatches(sas, 'master')).toBe(true)
    expect(competitorMatches(sas, 'sa')).toBe(true)
    expect(competitorMatches(sas, 'oracle')).toBe(false)
    expect(competitorMatches(sas, '  ')).toBe(true)
    expect(competitorMatches({ ...sas, category: 'Analytics Software', subCategories: ['Fraud'] }, 'fraud')).toBe(true)
    expect(competitorMatches({ ...sas, category: 'Analytics Software', subCategories: [] }, 'analytics')).toBe(true)
  })
})
