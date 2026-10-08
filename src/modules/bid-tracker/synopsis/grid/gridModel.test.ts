import { describe, expect, it } from 'vitest'
import { utils } from 'xlsx'
import { validateSynopsisDocument, validateSynopsisGrid, type SynopsisGrid } from '@goms/domain'
import { createTable, paragraph } from '../documents'
import {
  cellText, deleteColumn, deleteRows, duplicateRow, emptyGrid, insertColumn, insertRow, makeColumn, moveColumn, moveRow,
  parseCellText, parseClipboard, pasteText, setCell, sortRows, updateColumn,
} from './gridModel'
import { gridDocument, gridToWorksheet, readGridSection, worksheetToGrid } from './gridIO'

const ids = (grid: SynopsisGrid) => grid.rows.map(row => row.id)

describe('grid model', () => {
  it('moves, inserts, duplicates and deletes rows without mutating the input', () => {
    const grid = emptyGrid(2, 3)
    const [a, b, c] = ids(grid)
    expect(ids(moveRow(grid, 0, 2))).toEqual([b, c, a])
    expect(ids(grid)).toEqual([a, b, c])
    expect(insertRow(grid, 1).rows).toHaveLength(4)
    const withValue = setCell(grid, a, grid.columns[0].id, 'hello')
    const dup = duplicateRow(withValue, a)
    expect(dup.rows[1].cells[grid.columns[0].id]).toBe('hello')
    expect(dup.rows[1].id).not.toBe(a)
    expect(ids(deleteRows(grid, [b]))).toEqual([a, c])
  })

  it('reorders, inserts and deletes columns, clearing deleted cells', () => {
    const grid = emptyGrid(3, 1)
    const [x, y, z] = grid.columns.map(c => c.id)
    expect(moveColumn(grid, 2, 0).columns.map(c => c.id)).toEqual([z, x, y])
    const filled = setCell(grid, grid.rows[0].id, y, 'v')
    const removed = deleteColumn(filled, y)
    expect(removed.columns.map(c => c.id)).toEqual([x, z])
    expect(removed.rows[0].cells).not.toHaveProperty(y)
    expect(insertColumn(grid, 1, makeColumn('New')).columns[1].name).toBe('New')
    expect(() => deleteColumn(emptyGrid(1, 1), emptyGrid(1, 1).columns[0].id)).toThrow(/at least one column/)
  })

  it('converts text cells into dropdown options when the type changes', () => {
    let grid = emptyGrid(1, 3)
    const col = grid.columns[0].id
    grid = pasteText(grid, 0, [col], 0, [['complied'], ['not complied'], ['complied']])
    const select = updateColumn(grid, col, { type: 'singleSelect' })
    const column = select.columns[0]
    expect(column.options?.map(o => o.value)).toEqual(['complied', 'not complied'])
    expect(select.rows.map(row => cellText(column, row.cells[col]))).toEqual(['complied', 'not complied', 'complied'])
    expect(() => validateSynopsisGrid(select)).not.toThrow()
    const back = updateColumn(select, col, { type: 'text' })
    expect(back.columns[0].options).toBeUndefined()
    expect(back.rows[1].cells[col]).toBe('not complied')
  })

  it('parses typed values per field type', () => {
    expect(parseCellText(makeColumn('n', 'currency'), '₹ 3,00,000')).toBe(300000)
    expect(parseCellText(makeColumn('p', 'percent'), '30%')).toBe(30)
    expect(parseCellText(makeColumn('b', 'checkbox'), 'yes')).toBe(true)
    expect(parseCellText(makeColumn('d', 'date'), '05.11.2026')).toBe('2026-11-05')
    expect(parseCellText(makeColumn('u', 'url'), 'eprocure.gov.in')).toBe('https://eprocure.gov.in')
    expect(parseCellText(makeColumn('u', 'url'), 'not a link')).toBeNull()
  })

  it('pastes a range, adding rows and creating dropdown options', () => {
    let grid = emptyGrid(2, 1)
    grid = updateColumn(grid, grid.columns[1].id, { type: 'multiSelect' })
    const visible = grid.columns.map(c => c.id)
    const pasted = pasteText(grid, 0, visible, 0, parseClipboard('A\tx, y\nB\ty\n'))
    expect(pasted.rows).toHaveLength(2)
    expect(pasted.columns[1].options?.map(o => o.value)).toEqual(['x', 'y'])
    expect(cellText(pasted.columns[1], pasted.rows[0].cells[visible[1]])).toBe('x, y')
    expect(() => validateSynopsisGrid(pasted)).not.toThrow()
  })

  it('parses quoted Sheets/Excel clipboard cells with tabs, line breaks and quotes', () => {
    expect(parseClipboard('"a\nb"\tx\n"say ""hi"""\t"\n')).toEqual([['a\nb', 'x'], ['say "hi"', '"']])
    expect(parseClipboard('plain\tcells\n')).toEqual([['plain', 'cells']])
  })

  it('never guesses dates from loose text', () => {
    expect(parseCellText(makeColumn('d', 'date'), '2')).toBeNull()
    expect(parseCellText(makeColumn('d', 'date'), 'Foo 1')).toBeNull()
    expect(parseCellText(makeColumn('d', 'date'), '5 Nov 2026')).toBe('2026-11-05')
  })

  it('keeps the first value when a multi-select becomes single-select', () => {
    let grid = emptyGrid(1, 1)
    const col = grid.columns[0].id
    grid = updateColumn(grid, col, { type: 'multiSelect' })
    grid = pasteText(grid, 0, [col], 0, [['a, b']])
    const single = updateColumn(grid, col, { type: 'singleSelect' })
    expect(cellText(single.columns[0], single.rows[0].cells[col])).toBe('a')
  })

  it('sorts rows with empty values last', () => {
    let grid = updateColumn(emptyGrid(1, 3), emptyGrid(1, 3).columns[0].id, {})
    grid = { ...grid, columns: [{ ...grid.columns[0], type: 'number' }] }
    const col = grid.columns[0].id
    grid = setCell(setCell(grid, grid.rows[0].id, col, 5), grid.rows[2].id, col, 1)
    expect(sortRows(grid, col, 'asc').rows.map(r => r.cells[col] ?? null)).toEqual([1, 5, null])
    expect(sortRows(grid, col, 'desc').rows.map(r => r.cells[col] ?? null)).toEqual([5, 1, null])
  })
})

describe('grid documents', () => {
  it('round-trips a grid and notes through a valid section document', () => {
    const grid = emptyGrid()
    const doc = gridDocument(grid, 'line one\nline two')
    expect(() => validateSynopsisDocument(doc)).not.toThrow()
    expect(readGridSection(doc)).toEqual({ grid, notes: 'line one\nline two', converted: false })
  })

  it('upgrades an older rich-text table, keeping extra tables in the notes', () => {
    const doc = { type: 'doc', content: [paragraph('Intro'), createTable(['Item', 'Qty'], 2), createTable(['Other'], 1), paragraph()] }
    const section = readGridSection(doc)
    expect(section.converted).toBe(true)
    expect(section.grid.columns.map(c => c.name)).toEqual(['Item', 'Qty'])
    expect(section.grid.rows).toHaveLength(2)
    expect(section.notes).toContain('Intro')
    expect(section.notes).toContain('Other')
  })

  it('rejects invalid grids', () => {
    const grid = emptyGrid(1, 1)
    const bad = { ...grid, rows: [{ id: 'r1', cells: { nope: 'x' } }] }
    expect(() => validateSynopsisDocument(gridDocument(bad, ''))).toThrow(/unknown column/)
    expect(() => validateSynopsisDocument({ type: 'doc', content: [paragraph(), { type: 'paragraph', content: [{ type: 'grid', attrs: { grid } }] }] })).toThrow(/grid placement/)
  })

  it('imports and exports Excel sheets', () => {
    const grid = worksheetToGrid(utils.aoa_to_sheet([['Name', 'Amount'], ['EMD', '300000'], ['PBG', '10%']]))
    expect(grid.columns.map(c => c.name)).toEqual(['Name', 'Amount'])
    expect(grid.rows).toHaveLength(2)
    const sheet = gridToWorksheet(grid, 'note')
    expect(sheet.A1.v).toBe('Name')
    expect(sheet.B2.v).toBe('300000')
    expect(sheet.A5.v).toBe('note')
  })
})
