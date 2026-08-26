import { describe, it, expect } from 'vitest'
import { buildErrorReportCsv } from './errorReport.js'
import type { ImportRowResult } from './types.js'

describe('buildErrorReportCsv', () => {
  it('includes only rejected rows, with row number, business key, and reasons', () => {
    const rows: ImportRowResult[] = [
      { rowNumber: 1, businessKey: 'A', action: 'create', errors: [] },
      { rowNumber: 2, businessKey: 'B', action: 'reject', errors: ['Name is required', 'ratePct: must be a number'] },
    ]
    const csv = buildErrorReportCsv(rows)
    const lines = csv.trim().split('\n')
    expect(lines[0]).toBe('Row,Business Key,Errors')
    expect(lines).toHaveLength(2) // header + 1 rejected row only
    expect(lines[1]).toBe('2,B,"Name is required; ratePct: must be a number"')
  })

  it('returns just the header when nothing was rejected', () => {
    const csv = buildErrorReportCsv([{ rowNumber: 1, businessKey: 'A', action: 'create', errors: [] }])
    expect(csv.trim()).toBe('Row,Business Key,Errors')
  })

  it('escapes a comma inside a business key correctly for CSV', () => {
    const csv = buildErrorReportCsv([{ rowNumber: 1, businessKey: 'A, Inc', action: 'reject', errors: ['bad'] }])
    expect(csv).toContain('"A, Inc"')
  })

  it('escapes a double quote inside an error message by doubling it', () => {
    const csv = buildErrorReportCsv([{ rowNumber: 1, businessKey: 'A', action: 'reject', errors: ['bad "value"'] }])
    expect(csv).toContain('"bad ""value"""')
  })

  it('handles an empty input array', () => {
    expect(buildErrorReportCsv([]).trim()).toBe('Row,Business Key,Errors')
  })
})
