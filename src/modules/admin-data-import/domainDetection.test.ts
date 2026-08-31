import { describe, it, expect } from 'vitest'
import { detectDomainForSheet } from './domainDetection'

describe('detectDomainForSheet', () => {
  it('trusts an exact sheet title match with no ambiguity, even with a generic column signature', () => {
    const result = detectDomainForSheet('Tax Classes', ['Code', 'Name', 'Description', 'Rate %', 'Active', 'Display Order'])
    expect(result).toEqual({ kind: 'matched', domain: 'taxClasses', sheetTitle: 'Tax Classes' })
  })

  it('scores by required-field header overlap when the sheet title is not a known template title', () => {
    const result = detectDomainForSheet('My Org Chart', ['Node Type', 'Name', 'Code', 'Parent Code', 'State Code', 'Status'])
    expect(result).toEqual({ kind: 'matched', domain: 'organizationHierarchy', sheetTitle: 'Organization Hierarchy' })
  })

  it('recognizes alias headers during scoring, not just canonical ones', () => {
    const result = detectDomainForSheet('Staff List', ['Emp Code', 'Full Name', 'Job Title', 'Org Code'])
    expect(result).toEqual({ kind: 'matched', domain: 'employees', sheetTitle: 'Employees' })
  })

  it('reports ambiguous when two look-alike flat-master sheets score identically and the title matches neither', () => {
    const result = detectDomainForSheet('Random Sheet', ['Code', 'Name', 'Description', 'Active', 'Display Order'])
    expect(result.kind).toBe('ambiguous')
    if (result.kind === 'ambiguous') expect(result.candidates.length).toBeGreaterThan(1)
  })

  it('reports unrecognized when nothing clears the floor', () => {
    const result = detectDomainForSheet('Nonsense', ['Foo', 'Bar', 'Baz'])
    expect(result.kind).toBe('unrecognized')
  })
})
