import { describe, expect, it } from 'vitest'
import { documentToGeneral, generalToDocument, updateGeneralDocument } from './bidGeneral.js'
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
})
