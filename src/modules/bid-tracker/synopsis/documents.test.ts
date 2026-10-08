import { describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { BID_SYNOPSIS_SECTIONS, validateSynopsisDocument, type SynopsisNode } from '@goms/domain'
import { createTable, documentToWorksheet, paragraph, plainText, starterDocument, worksheetToDocument } from './documents'

describe('RFP section documents', () => {
  it('starts all table sections with the same neutral editable structure', () => {
    for (const section of BID_SYNOPSIS_SECTIONS) expect(() => validateSynopsisDocument(starterDocument(section))).not.toThrow()
    expect(starterDocument('scope').content?.[0].type).toBe('paragraph')
    expect(starterDocument('pq').content?.[0].content?.[0].content).toHaveLength(4)
    expect(starterDocument('boq')).toEqual(starterDocument('pq'))
    expect(plainText(starterDocument('pq'))).toContain('Column 1')
  })

  it('imports horizontal and vertical merges, highlights and multiple paragraphs', () => {
    const sheet = utils.aoa_to_sheet([['Group', null, 'Notes'], ['Alpha', 'First value', 'Line one\n\u25cf Line two\n\u25cf Line three'], [null, 'Second value', 'Last value']])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }, { s: { r: 1, c: 0 }, e: { r: 2, c: 0 } }]
    sheet.B2.s = { fgColor: { rgb: 'FFF2CC' } }
    const doc = worksheetToDocument(sheet)
    validateSynopsisDocument(doc)
    const rows = doc.content![0].content!
    expect(rows[0].content![0].attrs?.colspan).toBe(2)
    expect(rows[1].content![0].attrs?.rowspan).toBe(2)
    expect(rows[2].content).toHaveLength(2)
    expect(rows[1].content![1].attrs?.backgroundColor).toBe('#FFF2CC')
    expect(rows[1].content![2].content![1].type).toBe('bulletList')
    const exported = documentToWorksheet(doc)
    expect(exported['!merges']).toEqual(sheet['!merges'])
    expect(exported.C3.v).toBe('Last value')
  })

  it('turns scope sheets into a narrative rather than a huge merged table', () => {
    const sheet = utils.aoa_to_sheet([['First paragraph\nSecond paragraph'], [], ['Third paragraph']])
    sheet['!merges'] = [{ s: { r: 0, c: 0 }, e: { r: 1, c: 7 } }]
    const doc = worksheetToDocument(sheet, true)
    expect(doc.content?.map(node => node.type)).toEqual(['paragraph', 'paragraph', 'paragraph'])
    expect(plainText(doc)).toContain('Third paragraph')
  })

  it('rejects empty and oversized sheets before creating a table', () => {
    expect(() => worksheetToDocument({})).toThrow(/empty/)
    const sheet = utils.aoa_to_sheet(Array.from({ length: 501 }, () => ['x']))
    expect(() => worksheetToDocument(sheet)).toThrow(/500 rows/)
  })

  it('exports numbers and percentages as numeric Excel cells and preserves merge positions', () => {
    const table = createTable(['Item', 'Payment'], 1)
    table.content![1].content![1] = { type: 'tableCell', attrs: { cellFormat: 'percent' }, content: [paragraph('25%')] }
    const sheet = documentToWorksheet({ type: 'doc', content: [table] })
    expect(sheet.B2).toMatchObject({ t: 'n', v: 0.25, z: '0.00%' })
  })

  it('rejects malformed, deeply nested and unsafe-link documents', () => {
    expect(() => validateSynopsisDocument({ type: 'script', content: [] })).toThrow()
    const badLink: SynopsisNode = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'x', marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }] }] }] }
    expect(() => validateSynopsisDocument(badLink)).toThrow(/link/)
    let nested: SynopsisNode = paragraph('x')
    for (let i = 0; i < 30; i++) nested = { type: 'blockquote', content: [nested] }
    expect(() => validateSynopsisDocument({ type: 'doc', content: [nested] })).toThrow()
  })
})
