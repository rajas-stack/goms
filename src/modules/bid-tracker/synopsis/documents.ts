import type { BidSynopsisSection, SynopsisNode } from '@goms/domain'
import type { WorkSheet } from 'xlsx'
import { utils } from 'xlsx'
import { generalToDocument } from './generalFields'

export const SECTION_LABELS: Record<BidSynopsisSection, string> = {
  general: 'General', scope: 'Scope of Work', pq: 'PQ', tq: 'TQ', manpower: 'Manpower', milestone: 'Milestone', payment: 'Payment Terms', boq: 'BoQ', queries: 'Queries',
}

export function paragraph(text = ''): SynopsisNode {
  return { type: 'paragraph', content: text ? [{ type: 'text', text }] : [] }
}

export function createTable(columns: string[], rows = 3, header = true): SynopsisNode {
  return {
    type: 'table', content: [
      ...(header ? [{ type: 'tableRow', content: columns.map(label => ({ type: 'tableHeader', attrs: { colspan: 1, rowspan: 1, colwidth: null, wrap: true }, content: [paragraph(label)] })) }] : []),
      ...Array.from({ length: rows }, () => ({ type: 'tableRow', content: columns.map(() => ({ type: 'tableCell', attrs: { colspan: 1, rowspan: 1, colwidth: null, wrap: true }, content: [paragraph()] })) })),
    ],
  }
}

export function starterDocument(section: BidSynopsisSection): SynopsisNode {
  if (section === 'general') return generalToDocument({})
  return section === 'scope'
    ? { type: 'doc', content: [paragraph()] }
    : { type: 'doc', content: [createTable(['Column 1', 'Column 2', 'Column 3', 'Column 4']), paragraph()] }
}

function cellParagraphs(text: string): SynopsisNode[] {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const blocks: SynopsisNode[] = []
  let list: SynopsisNode | undefined
  for (const line of lines) {
    const bullet = /^\s*[\u2022\u25cf\u25aa]\s*(.*)$/.exec(line)
    if (bullet) {
      if (!list) { list = { type: 'bulletList', content: [] }; blocks.push(list) }
      list.content!.push({ type: 'listItem', content: [paragraph(bullet[1])] })
    } else { list = undefined; blocks.push(paragraph(line)) }
  }
  return blocks.length ? blocks : [paragraph()]
}

export function worksheetToDocument(sheet: WorkSheet, narrative = false): SynopsisNode {
  const cells = Object.entries(sheet).filter(([key, cell]) => !key.startsWith('!') && cell.v != null && String(cell.v).trim())
  if (!cells.length) throw new Error('This worksheet is empty. Select another sheet.')
  if (narrative) {
    return { type: 'doc', content: cells.sort(([a], [b]) => {
      const x = utils.decode_cell(a), y = utils.decode_cell(b)
      return x.r - y.r || x.c - y.c
    }).flatMap(([, cell]) => cellParagraphs(String(cell.w ?? cell.v))) }
  }
  const positions = cells.map(([key]) => utils.decode_cell(key))
  const merges = sheet['!merges'] ?? []
  const firstColumn = Math.min(...positions.map(p => p.c), ...merges.map(m => m.s.c))
  const lastColumn = Math.max(...positions.map(p => p.c), ...merges.map(m => m.e.c))
  const rows = [...new Set(positions.map(p => p.r))].sort((a, b) => a - b)
  const cols = lastColumn - firstColumn + 1
  if (rows.length > 500 || cols > 50 || rows.length * cols > 10_000) throw new Error('Import supports up to 500 rows, 50 columns and 10,000 cells per sheet.')
  const table: SynopsisNode = { type: 'table', content: [] }
  for (const r of rows) {
    const content: SynopsisNode[] = []
    for (let c = firstColumn; c <= lastColumn; c++) {
      const merge = merges.find(m => r >= m.s.r && r <= m.e.r && c >= m.s.c && c <= m.e.c)
      if (merge && (r !== merge.s.r || c !== merge.s.c)) continue
      const cell = sheet[utils.encode_cell({ r, c })]
      const fill = cell?.s?.fgColor?.rgb
      const backgroundColor = typeof fill === 'string' && /^[0-9a-f]{6}$/i.test(fill) ? `#${fill}` : null
      const text = String(cell?.w ?? cell?.v ?? '')
      content.push({
        type: 'tableCell', attrs: {
          colspan: merge ? merge.e.c - merge.s.c + 1 : 1,
          rowspan: merge ? rows.filter(row => row >= merge.s.r && row <= merge.e.r).length : 1,
          colwidth: null, backgroundColor, wrap: true,
          cellFormat: cell?.t === 'n' ? (cell?.z?.includes('%') ? 'percent' : 'number') : 'text',
        }, content: cellParagraphs(text),
      })
    }
    table.content!.push({ type: 'tableRow', content })
  }
  return { type: 'doc', content: [table, paragraph()] }
}

export function plainText(node: SynopsisNode): string {
  if (node.type === 'text') return node.text ?? ''
  if (node.type === 'hardBreak') return '\n'
  const separator = ['paragraph', 'heading'].includes(node.type) ? '' : '\n'
  const result = (node.content ?? []).map(plainText).join(separator)
  return node.type === 'listItem' ? `- ${result}` : result
}

export function documentToWorksheet(document: SynopsisNode): WorkSheet {
  const sheet: WorkSheet = {}
  const merges: NonNullable<WorkSheet['!merges']> = []
  let row = 0, maxColumn = 0
  for (const block of document.content ?? []) {
    if (block.type !== 'table') {
      const text = plainText(block)
      if (text) { sheet[utils.encode_cell({ r: row, c: 0 })] = { t: 's', v: text }; row++ }
      continue
    }
    const occupied = new Set<string>()
    let tableEnd = row
    for (const [offset, tableRow] of (block.content ?? []).entries()) {
      const r = row + offset
      let c = 0
      for (const cell of tableRow.content ?? []) {
        while (occupied.has(`${r}:${c}`)) c++
        const colspan = Number(cell.attrs?.colspan ?? 1), rowspan = Number(cell.attrs?.rowspan ?? 1)
        const text = plainText(cell)
        const format = cell.attrs?.cellFormat
        const numeric = text.replace(/[,\s\u20b9%]/g, '')
        const isNumeric = format !== 'text' && format != null && /^[-+]?\d*\.?\d+$/.test(numeric)
        sheet[utils.encode_cell({ r, c })] = isNumeric
          ? { t: 'n', v: Number(numeric) / (format === 'percent' ? 100 : 1), z: format === 'percent' ? '0.00%' : format === 'currency' ? '#,##0.00' : '#,##0.##' }
          : { t: 's', v: text }
        if (colspan > 1 || rowspan > 1) merges.push({ s: { r, c }, e: { r: r + rowspan - 1, c: c + colspan - 1 } })
        for (let rr = r; rr < r + rowspan; rr++) for (let cc = c; cc < c + colspan; cc++) occupied.add(`${rr}:${cc}`)
        maxColumn = Math.max(maxColumn, c + colspan - 1)
        tableEnd = Math.max(tableEnd, r + rowspan)
        c += colspan
      }
    }
    row = tableEnd + 1
  }
  sheet['!ref'] = utils.encode_range({ s: { r: 0, c: 0 }, e: { r: Math.max(0, row - 1), c: maxColumn } })
  sheet['!merges'] = merges
  sheet['!cols'] = Array.from({ length: maxColumn + 1 }, () => ({ wch: 30 }))
  return sheet
}
