import { describe, expect, it } from 'vitest'
import {
  allocateOpportunityCode, clientCode, fiscalPeriod, formatOpportunityCode, opportunityCodeParts, opportunityCodePrefix,
  opportunityTypeCode, parseLooseDate, scopeCode, stateCodeInfo, verticalCode,
} from '@goms/domain'

const TODAY = new Date(2026, 9, 5) // 5 Oct 2026, only used when no date is given

describe('opportunity code — the three reference examples', () => {
  it('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1', () => {
    const prefix = opportunityCodePrefix({
      submissionDate: '15-08-2026 14:00 Hrs', vertical: 'Data Fabric & AI', stateCode: 24,
      department: { shortName: 'DST', name: 'Department of Science and Technology' }, opportunityType: 'RFP', component: ['DL'],
    }, TODAY)
    expect(formatOpportunityCode(prefix, 1)).toBe('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1')
  })

  it('FY27-Q3-MOB-WEST-MH-MMRDA-EOI-ITMS-14', () => {
    const prefix = opportunityCodePrefix({
      submissionDate: '2026-10-10', vertical: 'Transit (Mobility)', stateCode: 27,
      department: { shortName: 'MMRDA', name: 'Mumbai Metropolitan Region Development Authority' }, opportunityType: 'EOI', component: ['ITMS', 'Hardware'],
    }, TODAY)
    expect(formatOpportunityCode(prefix, 14)).toBe('FY27-Q3-MOB-WEST-MH-MMRDA-EOI-ITMS-14')
  })

  it('FY27-Q1-GIS-SOUTH-TG-ITE-RFQ-IPMP-133', () => {
    const prefix = opportunityCodePrefix({
      submissionDate: '20/05/2026', vertical: 'GIS', stateCode: 36,
      department: { shortName: 'ITE', name: 'Information Technology, Electronics' }, opportunityType: 'RFQ', component: ['Software', 'IPMP'],
    }, TODAY)
    expect(formatOpportunityCode(prefix, 133)).toBe('FY27-Q1-GIS-SOUTH-TG-ITE-RFQ-IPMP-133')
  })
})

describe('fiscal period (Indian FY, Apr–Mar)', () => {
  it('splits FY26 / FY27 between 31 Mar and 1 Apr', () => {
    expect(fiscalPeriod(parseLooseDate('31-03-2026')!)).toEqual({ fiscalYear: 'FY26', quarter: 'Q4' })
    expect(fiscalPeriod(parseLooseDate('01-04-2026')!)).toEqual({ fiscalYear: 'FY27', quarter: 'Q1' })
    expect(fiscalPeriod(parseLooseDate('2026-12-31')!)).toEqual({ fiscalYear: 'FY27', quarter: 'Q3' })
    expect(fiscalPeriod(parseLooseDate('2027-01-01')!)).toEqual({ fiscalYear: 'FY27', quarter: 'Q4' })
  })

  it('reads an ISO instant in India time (1 Apr 00:30 IST is FY27, not March)', () => {
    expect(parseLooseDate('2026-03-31T19:00:00.000Z')).toEqual({ year: 2026, month: 4, day: 1 })
  })

  it('parses the messy formats submission dates come in', () => {
    expect(parseLooseDate('10-10-2026 14:00 Hrs')).toEqual({ year: 2026, month: 10, day: 10 })
    expect(parseLooseDate('5.7.26')).toEqual({ year: 2026, month: 7, day: 5 })
    expect(parseLooseDate('13th May 2026 3pm')).toEqual({ year: 2026, month: 5, day: 13 })
    expect(parseLooseDate('Oct 10, 2026')).toEqual({ year: 2026, month: 10, day: 10 })
    expect(parseLooseDate('TBD')).toBeNull()
    expect(parseLooseDate('')).toBeNull()
  })

  it('falls back to createdAt, then today, when the submission date is blank or unparseable', () => {
    expect(opportunityCodeParts({ submissionDate: 'soon', createdAt: '2027-02-01' }, TODAY).fiscalYear).toBe('FY27')
    expect(opportunityCodePrefix({ submissionDate: '', createdAt: '2027-04-02' }, TODAY).startsWith('FY28-Q1-')).toBe(true)
    expect(opportunityCodePrefix({}, TODAY).startsWith('FY27-Q3-')).toBe(true)
  })
})

describe('segments', () => {
  it('maps canonical verticals and their variants, and abbreviates unknown ones', () => {
    expect(['Traffic', 'Transit (Mobility)', 'Data Fabric & AI', 'Integrated (Smart City)', 'GIS', 'Agriculture', 'Resource & Utility', 'Cloud']
      .map(verticalCode)).toEqual(['TRF', 'MOB', 'DF', 'ISC', 'GIS', 'AGR', 'RU', 'CLD'])
    expect(verticalCode('Smart City')).toBe('ISC')
    expect(verticalCode('mobility')).toBe('MOB')
    expect(verticalCode('Health & Family Welfare')).toBe('HFW')
    expect(verticalCode('Healthcare')).toBe('HEA')
    expect(verticalCode('  ')).toBe('NA')
  })

  it('resolves state + zone from the LGD code; Central and unknown', () => {
    expect(stateCodeInfo(24)).toEqual({ state: 'GJ', zone: 'WEST' })
    expect(stateCodeInfo(9)).toEqual({ state: 'UP', zone: 'NORTH' })
    expect(stateCodeInfo(18)).toEqual({ state: 'AS', zone: 'NE' })
    expect(stateCodeInfo(0)).toEqual({ state: 'CEN', zone: 'CENTRAL' })
    expect(stateCodeInfo(null)).toEqual({ state: 'NA', zone: 'NA' })
    expect(stateCodeInfo(99)).toEqual({ state: 'NA', zone: 'NA' })
  })

  it('uses the short name, else the abbreviated department name, max 8 A–Z0–9', () => {
    expect(clientCode({ shortName: 'Gujarat-DST', name: 'x' })).toBe('GUJARATD')
    expect(clientCode({ shortName: '', name: 'Department of Science & Technology' })).toBe('DOST')
    expect(clientCode(null)).toBe('NA')
  })

  it('codes opportunity types', () => {
    expect(['RFP', 'RFQ', 'EOI', 'RFI', 'GeM', 'Tender', 'Direct', ''].map(opportunityTypeCode))
      .toEqual(['RFP', 'RFQ', 'EOI', 'RFI', 'GEM', 'TND', 'DIR', 'NA'])
  })

  it('picks the first AMNEX product (product-list order), else the first component', () => {
    expect(scopeCode(['Hardware', 'Locomate', 'Golden Record'])).toBe('GR')
    expect(scopeCode(['Hardware', 'Software'])).toBe('HW')
    expect(scopeCode(['ICCC'])).toBe('ICCC')
    expect(scopeCode(['Video Analytics Platform'])).toBe('VAP')
    expect(scopeCode([])).toBe('NA')
  })

  it('never produces an empty segment or a double dash', () => {
    const prefix = opportunityCodePrefix({ submissionDate: '01-01-2027' }, TODAY)
    expect(prefix).toBe('FY27-Q4-NA-NA-NA-NA-NA-NA')
    expect(formatOpportunityCode(prefix, 1)).not.toMatch(/--/)
  })
})

describe('sequence allocation', () => {
  const parts = { fiscalYear: 'FY27', prefix: 'FY27-Q2-DF-WEST-GJ-DST-RFP-DL' }

  it('is a plain integer with no leading zeros, one counter per fiscal year', () => {
    const first = allocateOpportunityCode(parts, {}, [])
    expect(first.code).toBe('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-1')
    const second = allocateOpportunityCode(parts, first.sequences, [first.code])
    expect(second.code).toBe('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-2')
    const nextYear = allocateOpportunityCode({ fiscalYear: 'FY28', prefix: 'FY28-Q1-NA-NA-NA-NA-NA-NA' }, second.sequences, [])
    expect(nextYear.code).toBe('FY28-Q1-NA-NA-NA-NA-NA-NA-1')
    expect(nextYear.sequences).toEqual({ FY27: 3, FY28: 2 })
  })

  it('skips numbers a same-FY code already uses, even when the counter is stale', () => {
    const out = allocateOpportunityCode(parts, { FY27: 1 }, ['FY27-Q4-NA-NA-NA-NA-NA-NA-1', 'FY27-Q1-GIS-SOUTH-TG-ITE-RFQ-IPMP-2', 'FY26-Q4-X-3'])
    expect(out.code).toBe('FY27-Q2-DF-WEST-GJ-DST-RFP-DL-3')
  })
})
