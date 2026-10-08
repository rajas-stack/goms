import { describe, expect, it } from 'vitest'
import { validateSynopsisDocument } from '@goms/domain'
import { documentToGeneral, GENERAL_FIELDS, generalToDocument } from './generalFields'
import { starterDocument } from './documents'

describe('General section fields', () => {
  it('starts as a valid Field | Value table with one row per field', () => {
    const doc = starterDocument('general')
    expect(() => validateSynopsisDocument(doc)).not.toThrow()
    expect(doc.content![0].content).toHaveLength(GENERAL_FIELDS.length + 1)
    expect(documentToGeneral(doc)).toEqual(Object.fromEntries(GENERAL_FIELDS.map(field => [field.key, ''])))
  })

  it('round-trips values, including multi-line text', () => {
    const values = {
      referenceNo: 'PPAC/IT/DIP/2026/001',
      bidDeadline: '2026-11-05T12:00',
      projectOfficer: 'Arun Prakash Verma\nPetroleum Planning & Analysis Cell',
      pqCompliance: 'not complied',
    }
    const doc = generalToDocument(values)
    expect(() => validateSynopsisDocument(doc)).not.toThrow()
    const read = documentToGeneral(doc)
    expect(read).toMatchObject(values)
    expect(read.tenderId).toBe('')
  })

  it('reads rows by label regardless of order and ignores unknown rows', () => {
    const doc = generalToDocument({ tenderId: '2026_PPAC_927042_1' })
    const table = doc.content![0]
    table.content = [table.content![0], ...table.content!.slice(1).reverse(), {
      type: 'tableRow', content: [
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Unrelated' }] }] },
        { type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x' }] }] },
      ],
    }]
    expect(documentToGeneral(doc).tenderId).toBe('2026_PPAC_927042_1')
    expect(documentToGeneral(doc)).not.toHaveProperty('Unrelated')
  })

  it('treats a missing document as empty', () => {
    expect(documentToGeneral(null)).toEqual({})
  })

  it('splits the old meeting row without losing its address or attendance notes', () => {
    const text = (value: string) => ({ type: 'tableCell', content: [{ type: 'paragraph', content: [{ type: 'text', text: value }] }] })
    const document = { type: 'doc', content: [{ type: 'table', content: [{ type: 'tableRow', content: [
      text('Pre-Bid Meeting date & Time & Address'),
      text('15-Oct-2026 11:00 AM\n2nd floor, Scope Complex, New Delhi\nMaximum 3 persons allowed\nPrior written intimation required'),
    ] }] }] }
    const values = documentToGeneral(document)
    expect(values).toEqual({ preBidMeeting: '2026-10-15T11:00', preBidMeetingAddress: '2nd floor, Scope Complex, New Delhi',
      preBidMeetingNotes: 'Maximum 3 persons allowed\nPrior written intimation required' })
    expect(documentToGeneral(generalToDocument(values))).toMatchObject(values)
  })
})
