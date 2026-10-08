import type { GridColumn, SynopsisGrid, SynopsisNode } from '@goms/domain'
import { utils, type WorkSheet } from 'xlsx'
import { plainText } from '../documents'
import { cellText, emptyGrid, makeColumn, makeRow, pasteText } from './gridModel'

export interface GridSection {
  grid: SynopsisGrid
  notes: string
  /** True when the saved document was in the older rich-text table format and
   *  was converted on load — the user should review and save. */
  converted: boolean
}

function notesParagraphs(notes: string): SynopsisNode[] {
  const lines = notes.replace(/\r\n?/g, '\n').split('\n')
  return lines.map(line => ({ type: 'paragraph', content: line ? [{ type: 'text', text: line }] : [] }))
}

export function gridDocument(grid: SynopsisGrid, notes: string): SynopsisNode {
  return { type: 'doc', content: [{ type: 'grid', attrs: { grid } }, ...notesParagraphs(notes)] }
}

/** Matrix of cell texts from a rich-text table, expanding merged cells. */
function tableMatrix(table: SynopsisNode): string[][] {
  const matrix: string[][] = []
  ;(table.content ?? []).forEach((row, r) => {
    matrix[r] ??= []
    let c = 0
    for (const cell of row.content ?? []) {
      while (matrix[r][c] !== undefined) c++
      const colspan = Number(cell.attrs?.colspan ?? 1), rowspan = Number(cell.attrs?.rowspan ?? 1)
      const text = plainText(cell)
      for (let rr = r; rr < r + rowspan; rr++) {
        matrix[rr] ??= []
        for (let cc = c; cc < c + colspan; cc++) matrix[rr][cc] = rr === r && cc === c ? text : ''
      }
      c += colspan
    }
  })
  const width = Math.max(1, ...matrix.map(row => row.length))
  return matrix.map(row => Array.from({ length: width }, (_, i) => row[i] ?? ''))
}

/** First matrix row becomes column names; the rest become rows. */
export function matrixToGrid(matrix: string[][]): SynopsisGrid {
  if (!matrix.length) return emptyGrid()
  const width = Math.min(50, Math.max(1, ...matrix.map(row => row.length)))
  const columns: GridColumn[] = Array.from({ length: width }, (_, i) => makeColumn((matrix[0][i] ?? '').trim().slice(0, 120) || `Column ${i + 1}`))
  const base: SynopsisGrid = { columns, rows: [] }
  const body = matrix.slice(1, 1001)
  return body.length ? pasteText(base, 0, columns.map(c => c.id), 0, body) : { columns, rows: [makeRow()] }
}

export function readGridSection(document: SynopsisNode | null | undefined): GridSection {
  const blocks = document?.content ?? []
  const gridNode = blocks.find(block => block.type === 'grid')
  if (gridNode) {
    const notes = blocks.filter(block => block.type !== 'grid').map(plainText).join('\n').replace(/\n+$/, '')
    return { grid: gridNode.attrs!.grid as SynopsisGrid, notes, converted: false }
  }
  const tables = blocks.filter(block => block.type === 'table')
  if (!tables.length) {
    const notes = blocks.map(plainText).join('\n').replace(/\n+$/, '')
    return { grid: emptyGrid(), notes, converted: !!document && !!notes }
  }
  // Older format: the first table becomes the grid; any other tables (and
  // anything beyond the grid's limits) are kept as tab-separated text in the
  // notes so nothing is lost.
  const [first, ...rest] = tables
  const matrix = tableMatrix(first)
  const fits = matrix.slice(0, 1001).map(row => row.slice(0, 50))
  const overflow = matrix.length > 1001 || matrix.some(row => row.length > 50)
  const notes = [
    ...blocks.filter(block => block !== first).map(block => (block.type === 'table' && rest.includes(block)
      ? tableMatrix(block).map(row => row.join('\t')).join('\n')
      : plainText(block))),
    ...(overflow ? ['Cells beyond 1,000 rows / 50 columns from the original table:', matrix.map(row => row.join('\t')).join('\n')] : []),
  ].join('\n').replace(/\n+$/, '')
  return { grid: matrixToGrid(fits), notes, converted: true }
}

export function worksheetToGrid(sheet: WorkSheet): SynopsisGrid {
  const bounds = sheet['!ref'] ? utils.decode_range(sheet['!ref']) : null
  if (bounds && (bounds.e.r - bounds.s.r > 1000 || bounds.e.c - bounds.s.c >= 50)) throw new Error('Import supports up to 1,000 rows and 50 columns per sheet.')
  const matrix = utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: '', blankrows: false })
    .map(row => row.map(value => String(value ?? '')))
  if (!matrix.length) throw new Error('This worksheet is empty. Select another sheet.')
  if (matrix.length > 1001 || matrix.some(row => row.length > 50)) throw new Error('Import supports up to 1,000 rows and 50 columns per sheet.')
  return matrixToGrid(matrix)
}

export function gridToWorksheet(grid: SynopsisGrid, notes: string): WorkSheet {
  const visible = grid.columns.filter(column => !column.hidden)
  const aoa: unknown[][] = [visible.map(column => column.name)]
  for (const row of grid.rows) {
    aoa.push(visible.map(column => {
      const value = row.cells[column.id]
      if (typeof value === 'number') return column.type === 'percent' ? value / 100 : value
      return cellText(column, value)
    }))
  }
  if (notes.trim()) { aoa.push([]); for (const line of notes.split('\n')) aoa.push([line]) }
  const sheet = utils.aoa_to_sheet(aoa)
  visible.forEach((column, c) => {
    if (column.type !== 'percent' && column.type !== 'currency') return
    for (let r = 1; r <= grid.rows.length; r++) {
      const cell = sheet[utils.encode_cell({ r, c })]
      if (cell?.t === 'n') cell.z = column.type === 'percent' ? '0.00%' : '#,##0.00'
    }
  })
  sheet['!cols'] = visible.map(column => ({ wpx: column.width ?? 180 }))
  return sheet
}
