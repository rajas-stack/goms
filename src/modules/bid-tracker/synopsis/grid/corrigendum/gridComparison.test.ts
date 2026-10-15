import { describe, expect, it } from 'vitest'
import { buildGridFieldKey, isGridFieldKey, parseGridFieldKey, type SynopsisGrid } from '@goms/domain'
import type { BidCorrigendum, BidCorrigendumChange } from '@/lib/types'
import { corrigendaAcceptingKey, DEFAULT_REGISTER } from '../../../corrigenda/model'
import { buildTenderPosition } from '../../../corrigenda/tenderPosition'
import { gridDocument } from '../gridIO'
import { buildGridComparison } from './gridComparison'
import { clauseDraftFromCell } from './recordFromCell'

const grid: SynopsisGrid = {
  columns: [{ id: 'cName', name: 'Criteria', type: 'text' }, { id: 'cReq', name: 'Requirement', type: 'longText' }],
  rows: [
    { id: 'r1', cells: { cName: 'Turnover', cReq: 'Average turnover of ₹100 Crore' } },
    { id: 'r2', cells: { cName: 'Experience', cReq: '3 similar projects' } },
    { id: 'r3', cells: { cName: 'Net worth', cReq: 'Positive net worth' } },
  ],
}
const key = (rowId: string, columnId = 'cReq') => buildGridFieldKey({ section: 'pq', rowId, columnId })

let seq = 0
function change(fieldKey: string, before: string, after: string, extra: Partial<BidCorrigendumChange> = {}): BidCorrigendumChange {
  seq += 1
  return {
    id: `ch${seq}`, corrigendumId: '', fieldKey, currentValue: before, proposedValue: after, decision: 'pending', decidedAt: null, decidedBy: null,
    kind: 'clause', clauseTitle: fieldKey, affectedModule: 'pq', classification: 'modified', impactLevel: 'medium', sourceRef: '', ...extra,
  }
}
function corrigendum(n: number, changes: BidCorrigendumChange[], sourceDocumentId: string | null = null): BidCorrigendum {
  const id = `cor${n}`
  return {
    id, bidId: 'b1', corrigendumNumber: n, sourceDocumentId, detectedAt: '', reviewedAt: null, reviewedBy: null, status: 'pending_review',
    ...DEFAULT_REGISTER, changes: changes.map((c) => ({ ...c, corrigendumId: id })),
  }
}
const compare = (corrigenda: BidCorrigendum[], g: SynopsisGrid = grid) => buildGridComparison(g, 'pq', buildTenderPosition(corrigenda))

describe('grid field keys', () => {
  it('builds and parses grid:<section>:<rowId>:<columnId>', () => {
    expect(key('r1')).toBe('grid:pq:r1:cReq')
    expect(parseGridFieldKey('grid:boq:row_1:col-2')).toEqual({ section: 'boq', rowId: 'row_1', columnId: 'col-2' })
  })
  it('rejects non-grid, unknown-section and malformed keys', () => {
    expect(parseGridFieldKey('pq.turnover')).toBeNull()
    expect(parseGridFieldKey('grid:nope:r1:c1')).toBeNull()
    expect(parseGridFieldKey('grid:pq:r1')).toBeNull()
    expect(parseGridFieldKey('grid:pq:r 1:c1')).toBeNull()
    expect(isGridFieldKey('grid:pq:r1:c1')).toBe(true)
    expect(() => buildGridFieldKey({ section: 'pq', rowId: 'bad id', columnId: 'c' })).toThrow()
  })
})

describe('derived after-columns', () => {
  it('leaves unchanged cells blank and shows the effective value with a word diff for changed ones', () => {
    const result = compare([corrigendum(1, [change(key('r1'), 'Average turnover of ₹100 Crore', 'Average turnover of ₹75 Crore')])])
    const column = result.columns.cReq
    expect(column.header).toBe('Requirement · After C1')
    expect(Object.keys(column.cells)).toEqual(['r1'])
    expect(column.cells.r1.text).toBe('Average turnover of ₹75 Crore')
    expect(column.cells.r1.code).toBe('C1')
    expect(column.cells.r1.segments.filter((s) => s.type === 'added').map((s) => s.text).join('')).toContain('75')
    expect(column.cells.r1.segments.filter((s) => s.type === 'same').map((s) => s.text).join('')).toContain('Average turnover of')
    expect(result.columns.cName).toBeUndefined()
    expect(result.count).toBe(1)
  })

  it('uses the latest non-rejected version and names it in the header', () => {
    const c1 = corrigendum(1, [change(key('r2'), '3 similar projects', '2 similar projects')])
    const c2 = corrigendum(2, [change(key('r2'), '2 similar projects', '1 similar project', { decision: 'rejected' })])
    const result = compare([c1, c2])
    expect(result.columns.cReq.cells.r2).toMatchObject({ text: '2 similar projects', code: 'C1' })
    expect(result.columns.cReq.header).toBe('Requirement · After C1')
    const accepted = compare([c1, corrigendum(2, [change(key('r2'), '2 similar projects', '1 similar project', { decision: 'accepted' })])])
    expect(accepted.columns.cReq.cells.r2).toMatchObject({ text: '1 similar project', code: 'C2' })
  })

  it('is blank when every version was rejected', () => {
    const result = compare([corrigendum(1, [change(key('r1'), 'a', 'b', { decision: 'rejected' })])])
    expect(result.columns).toEqual({})
    expect(result.count).toBe(0)
  })

  it('marks added rows as new and deleted clauses as deleted', () => {
    const result = compare([corrigendum(2, [
      change(key('r3'), '', 'Positive net worth for 3 years', { classification: 'added' }),
      change(key('r2'), '3 similar projects', '', { classification: 'deleted' }),
    ])])
    expect(result.newRows).toEqual({ r3: 'C2' })
    expect(result.columns.cReq.cells.r3.status).toBe('added')
    expect(result.columns.cReq.cells.r2.status).toBe('deleted')
    expect(result.columns.cReq.cells.r2.segments).toEqual([{ type: 'removed', text: '3 similar projects' }])
  })

  it('ignores other sections and non-grid keys, and lists changes whose row was removed', () => {
    const result = compare([corrigendum(1, [
      change('pq.turnover', 'x', 'y'),
      change(buildGridFieldKey({ section: 'boq', rowId: 'r1', columnId: 'cReq' }), 'x', 'y'),
      change(key('gone'), 'x', 'y'),
    ])])
    expect(result.columns).toEqual({})
    expect(result.orphans.map((h) => h.key)).toEqual(['grid:pq:gone:cReq'])
  })

  it('never writes anything into the grid or its saved document', () => {
    const before = JSON.stringify(gridDocument(grid, ''))
    compare([corrigendum(1, [change(key('r1'), 'Average turnover of ₹100 Crore', 'Average turnover of ₹75 Crore')])])
    expect(JSON.stringify(gridDocument(grid, ''))).toBe(before)
    expect(before).not.toContain('After C1')
  })
})

describe('record corrigendum change from a cell', () => {
  it('pre-fills title, module, original text and the grid key', () => {
    const draft = clauseDraftFromCell(grid, 'pq', 'r1', 'cReq', [])
    expect(draft).toMatchObject({
      existingKey: '', fieldKey: 'grid:pq:r1:cReq', title: 'Turnover — Requirement', module: 'pq',
      original: 'Average turnover of ₹100 Crore', linkLabel: 'PQ › Turnover › Requirement',
    })
    expect(clauseDraftFromCell(grid, 'boq', 'r2', 'cName', []).module).toBe('boq')
    expect(clauseDraftFromCell(grid, 'payment', 'r2', 'cName', []).module).toBe('payment_terms')
  })

  it('chains from the current effective text when the cell is already tracked', () => {
    const histories = buildTenderPosition([corrigendum(1, [change(key('r1'), 'Average turnover of ₹100 Crore', 'Average turnover of ₹75 Crore', { clauseTitle: 'PQ 2.1 Turnover' })])])
    expect(clauseDraftFromCell(grid, 'pq', 'r1', 'cReq', histories)).toMatchObject({
      existingKey: 'grid:pq:r1:cReq', title: 'PQ 2.1 Turnover', original: 'Average turnover of ₹75 Crore',
    })
  })

  it('falls back to "Row N" when the first column is empty, and rejects a missing cell', () => {
    const blank: SynopsisGrid = { ...grid, rows: [{ id: 'r9', cells: { cReq: 'x' } }] }
    expect(clauseDraftFromCell(blank, 'pq', 'r9', 'cReq', []).title).toBe('Row 1 — Requirement')
    expect(() => clauseDraftFromCell(grid, 'pq', 'nope', 'cReq', [])).toThrow(/no longer in the grid/)
  })

  it('offers only corrigenda newer than the clause\'s latest version', () => {
    const all = [corrigendum(1, [change(key('r1'), 'a', 'b')]), corrigendum(2, []), corrigendum(3, [])]
    expect(corrigendaAcceptingKey(all, key('r1')).map((c) => c.corrigendumNumber)).toEqual([2, 3])
    expect(corrigendaAcceptingKey(all, key('r2')).map((c) => c.corrigendumNumber)).toEqual([1, 2, 3])
  })
})
