import { describe, expect, it } from 'vitest'
import { GENERAL_FIELDS, documentToGeneral, generalFieldType, generalToDocument, updateGeneralDocument } from './bidGeneral.js'
import { parseMultiValue } from './bidCustomFields.js'
import { applyFilterRules } from './bids.js'
import { validateSynopsisDocument } from './bidSynopsis.js'

describe('shared General documents', () => {
  it('identifies fields by stable keys even when a displayed label changes', () => {
    const document = generalToDocument({ referenceNo: 'REF-5' })
    const row = document.content![0].content!.find(candidate => candidate.attrs?.fieldKey === 'referenceNo')!
    row.content![0].content![0].content![0].text = 'Renamed reference'
    expect(documentToGeneral(document).referenceNo).toBe('REF-5')
  })

  it('updates one field while preserving other values and unknown rows', () => {
    const document = generalToDocument({ scopeOfWork: 'Original scope', preBidMeeting: '2026-10-15T11:00' })
    const extra = { type: 'tableRow', content: [{ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Imported extra' }] }] }] }
    document.content![0].content!.push(extra)
    const next = updateGeneralDocument(document, 'scopeOfWork', 'New scope')
    expect(documentToGeneral(next)).toMatchObject({ scopeOfWork: 'New scope', preBidMeeting: '2026-10-15T11:00' })
    expect(next.content![0].content).toContainEqual(extra)
    expect(documentToGeneral(document).scopeOfWork).toBe('Original scope')
    expect(() => validateSynopsisDocument(next)).not.toThrow()
  })

  it('creates a valid first document and permits clearing a field', () => {
    const first = updateGeneralDocument(null, 'tenderId', 'TND-9')
    const cleared = updateGeneralDocument(first, 'tenderId', '')
    expect(documentToGeneral(cleared).tenderId).toBe('')
    expect(() => validateSynopsisDocument(cleared)).not.toThrow()
  })

  it('reads and updates a Scope of Work row saved before it was renamed Requirement', () => {
    const row = (label: string, text: string) => ({ type: 'tableRow', content: [label, text].map(t => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: t }] }] })) })
    const legacy = { type: 'doc', content: [{ type: 'table', content: [row('Scope of Work', 'CCTV')] }] }
    expect(documentToGeneral(legacy).scopeOfWork).toBe('CCTV')
    const next = updateGeneralDocument(legacy, 'scopeOfWork', 'CCTV\nITMS')
    expect(next.content![0].content).toHaveLength(1)
    expect(documentToGeneral(next).scopeOfWork).toBe('CCTV\nITMS')
    expect(next.content![0].content![0].content![0].content![0].content![0].text).toBe('Requirement')
  })
})

describe('General multi-select fields (Requirement, Products)', () => {
  const requirement = GENERAL_FIELDS.find(field => field.key === 'scopeOfWork')!
  it('pick from a Live Bids master and filter as a multi-select over one value per line', () => {
    expect(requirement).toMatchObject({ label: 'Requirement', kind: 'multiselect', master: 'requirements' })
    expect(GENERAL_FIELDS.find(field => field.key === 'products')).toMatchObject({ kind: 'multiselect', master: 'bidProducts' })
    expect(generalFieldType(requirement)).toBe('multiselect')
    expect(parseMultiValue('CCTV\n ITMS \n\n')).toEqual(['CCTV', 'ITMS'])
    expect(parseMultiValue('["A","B"]')).toEqual(['A', 'B'])
    const rows = [{ id: 'a', generalValues: { scopeOfWork: 'CCTV\nITMS' } }, { id: 'b', generalValues: { scopeOfWork: 'Smart transit' } }]
    expect(applyFilterRules(rows, [{ field: 'general:scopeOfWork', operator: 'eq', value: 'ITMS' }], null).map(r => r.id)).toEqual(['a'])
    expect(applyFilterRules(rows, [{ field: 'general:scopeOfWork', operator: 'in', value: '', values: ['Smart transit'] }], null).map(r => r.id)).toEqual(['b'])
    // A saved "contains" rule from the free-text days still matches.
    expect(applyFilterRules(rows, [{ field: 'general:scopeOfWork', operator: 'contains', value: 'transit' }], null).map(r => r.id)).toEqual(['b'])
  })
})
