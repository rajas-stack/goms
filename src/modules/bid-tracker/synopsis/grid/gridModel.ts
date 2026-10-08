import {
  GRID_LIMITS, GRID_OPTION_COLORS,
  type GridCellValue, type GridColumn, type GridFieldType, type GridRow, type GridSelectOption, type SynopsisGrid,
} from '@goms/domain'

/** Pure, immutable operations on a synopsis grid. Every function returns a new
 *  grid and never touches its input. */

let counter = 0
export function newId(prefix: string): string {
  counter = (counter + 1) % 1_000_000
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

export const FIELD_TYPE_LABELS: Record<GridFieldType, string> = {
  text: 'Single line text', longText: 'Long text', number: 'Number', currency: 'Currency (INR)', percent: 'Percent',
  date: 'Date', singleSelect: 'Single select', multiSelect: 'Multiple select', checkbox: 'Boolean', url: 'URL',
}

export const FIELD_TYPE_ICONS: Record<GridFieldType, string> = {
  text: 'Type', longText: 'FileText', number: 'Hash', currency: 'Calculator', percent: 'PieChart',
  date: 'Calendar', singleSelect: 'ChevronDown', multiSelect: 'List', checkbox: 'Check', url: 'Link2',
}

export function makeColumn(name: string, type: GridFieldType = 'text'): GridColumn {
  return { id: newId('c'), name, type, ...(type === 'singleSelect' || type === 'multiSelect' ? { options: [] } : {}) }
}

export function makeRow(): GridRow { return { id: newId('r'), cells: {} } }

export function emptyGrid(columns = 4, rows = 3): SynopsisGrid {
  return {
    columns: Array.from({ length: columns }, (_, i) => makeColumn(`Column ${i + 1}`)),
    rows: Array.from({ length: rows }, makeRow),
  }
}

function moveItem<T>(items: readonly T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= items.length) return [...items]
  const next = [...items]
  const [item] = next.splice(from, 1)
  next.splice(Math.max(0, Math.min(to, next.length)), 0, item)
  return next
}

// ---- rows ----

export function insertRow(grid: SynopsisGrid, index: number, row: GridRow = makeRow()): SynopsisGrid {
  if (grid.rows.length >= GRID_LIMITS.rows) throw new Error(`A grid can hold up to ${GRID_LIMITS.rows} rows.`)
  const rows = [...grid.rows]
  rows.splice(Math.max(0, Math.min(index, rows.length)), 0, row)
  return { ...grid, rows }
}

export function deleteRows(grid: SynopsisGrid, ids: readonly string[]): SynopsisGrid {
  const drop = new Set(ids)
  return { ...grid, rows: grid.rows.filter(row => !drop.has(row.id)) }
}

export function duplicateRow(grid: SynopsisGrid, id: string): SynopsisGrid {
  const index = grid.rows.findIndex(row => row.id === id)
  if (index < 0) return grid
  const source = grid.rows[index]
  const cells = Object.fromEntries(Object.entries(source.cells).map(([key, value]) => [key, Array.isArray(value) ? [...value] : value]))
  return insertRow(grid, index + 1, { id: newId('r'), cells })
}

export function moveRow(grid: SynopsisGrid, from: number, to: number): SynopsisGrid {
  return { ...grid, rows: moveItem(grid.rows, from, to) }
}

// ---- columns ----

export function insertColumn(grid: SynopsisGrid, index: number, column: GridColumn = makeColumn(`Column ${grid.columns.length + 1}`)): SynopsisGrid {
  if (grid.columns.length >= GRID_LIMITS.columns) throw new Error(`A grid can hold up to ${GRID_LIMITS.columns} columns.`)
  const columns = [...grid.columns]
  columns.splice(Math.max(0, Math.min(index, columns.length)), 0, column)
  return { ...grid, columns }
}

export function deleteColumn(grid: SynopsisGrid, id: string): SynopsisGrid {
  if (grid.columns.length <= 1) throw new Error('A grid needs at least one column.')
  return {
    ...grid,
    columns: grid.columns.filter(column => column.id !== id),
    rows: grid.rows.map(row => {
      if (!(id in row.cells)) return row
      const { [id]: _removed, ...cells } = row.cells
      return { ...row, cells }
    }),
  }
}

export function moveColumn(grid: SynopsisGrid, from: number, to: number): SynopsisGrid {
  return { ...grid, columns: moveItem(grid.columns, from, to) }
}

/** Rename / resize / hide, or change type (cell values are converted). */
export function updateColumn(grid: SynopsisGrid, id: string, patch: Partial<Omit<GridColumn, 'id'>>): SynopsisGrid {
  const current = grid.columns.find(column => column.id === id)
  if (!current) return grid
  if (patch.options && patch.options.length > GRID_LIMITS.options) throw new Error(`A column can have up to ${GRID_LIMITS.options} options.`)
  let next: GridColumn = { ...current, ...patch }
  const isSelect = (type: GridFieldType) => type === 'singleSelect' || type === 'multiSelect'
  let rows = grid.rows
  if (patch.type && patch.type !== current.type) {
    if (isSelect(next.type) && !next.options) next = { ...next, options: current.options ?? [] }
    // Turning text into a select: every distinct value becomes an option.
    if (isSelect(next.type) && !isSelect(current.type)) {
      const options = [...(next.options ?? [])]
      for (const row of grid.rows) {
        for (const part of splitList(cellText(current, row.cells[id]), next.type)) {
          if (part && !options.some(o => o.value.toLowerCase() === part.toLowerCase())) options.push(makeOption(part, options.length))
        }
      }
      next = { ...next, options: options.slice(0, GRID_LIMITS.options) }
    }
    if (!isSelect(next.type)) { const { options: _dropped, ...rest } = next; next = rest }
    rows = grid.rows.map(row => ({ ...row, cells: { ...row.cells, [id]: parseCellText(next, cellText(current, row.cells[id])) } }))
  } else if (patch.options && isSelect(current.type)) {
    // Removed options are cleared from cells.
    const keep = new Set(patch.options.map(o => o.id))
    rows = grid.rows.map(row => {
      const value = row.cells[id]
      if (typeof value === 'string' && !keep.has(value)) return { ...row, cells: { ...row.cells, [id]: null } }
      if (Array.isArray(value) && value.some(v => !keep.has(v))) return { ...row, cells: { ...row.cells, [id]: value.filter(v => keep.has(v)) } }
      return row
    })
  }
  return { ...grid, columns: grid.columns.map(column => (column.id === id ? next : column)), rows }
}

export function makeOption(value: string, index: number): GridSelectOption {
  return { id: newId('o'), value: value.slice(0, GRID_LIMITS.name), color: GRID_OPTION_COLORS[index % GRID_OPTION_COLORS.length] }
}

// ---- cells ----

export function setCell(grid: SynopsisGrid, rowId: string, columnId: string, value: GridCellValue): SynopsisGrid {
  return { ...grid, rows: grid.rows.map(row => (row.id === rowId ? { ...row, cells: { ...row.cells, [columnId]: value } } : row)) }
}

const NUMBER_TYPES: GridFieldType[] = ['number', 'currency', 'percent']

/** Human text for a cell — what is shown, copied and exported. */
export function cellText(column: GridColumn, value: GridCellValue | undefined): string {
  if (value === null || value === undefined) return ''
  switch (column.type) {
    case 'checkbox': return value === true ? 'TRUE' : value === false ? 'FALSE' : ''
    case 'singleSelect': return column.options?.find(o => o.id === value)?.value ?? ''
    case 'multiSelect': return Array.isArray(value) ? value.map(v => column.options?.find(o => o.id === v)?.value).filter(Boolean).join(', ') : ''
    default: return String(value)
  }
}

function splitList(text: string, type: GridFieldType): string[] {
  return type === 'multiSelect' ? text.split(/[,;\n]/).map(part => part.trim()).filter(Boolean) : [text.trim()]
}

/** Parse typed or pasted text into a column's value. Unknown select values
 *  yield `null`; use `pasteText` to create options on the fly. */
export function parseCellText(column: GridColumn, raw: string): GridCellValue {
  const text = raw.trim()
  if (!text) return column.type === 'checkbox' ? false : null
  if (NUMBER_TYPES.includes(column.type)) {
    const number = Number(text.replace(/[,\s₹%]/g, ''))
    return Number.isFinite(number) ? number : null
  }
  switch (column.type) {
    case 'checkbox': return /^(true|yes|y|1|x|✓|checked)$/i.test(text)
    case 'date': return toIsoDate(text)
    case 'url': return /^(https?:|mailto:)/i.test(text) ? text : /^[\w-]+(\.[\w-]+)+/.test(text) ? `https://${text}` : null
    case 'singleSelect': {
      // Exact match first; otherwise the first of a list (multi → single keeps one value).
      const find = (value: string) => column.options?.find(o => o.value.toLowerCase() === value.toLowerCase())?.id
      return find(text) ?? find(splitList(text, 'multiSelect')[0] ?? '') ?? null
    }
    case 'multiSelect': {
      const ids = splitList(text, 'multiSelect').map(part => column.options?.find(o => o.value.toLowerCase() === part.toLowerCase())?.id).filter((id): id is string => !!id)
      return ids.length ? [...new Set(ids)] : null
    }
    default: return text.slice(0, GRID_LIMITS.text)
  }
}

function toIsoDate(text: string): string | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text
  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(text)
  if (dmy) {
    const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3])
    const date = new Date(Date.UTC(year, Number(dmy[2]) - 1, Number(dmy[1])))
    if (date.getUTCDate() === Number(dmy[1]) && date.getUTCMonth() === Number(dmy[2]) - 1) return date.toISOString().slice(0, 10)
  }
  // "5 Nov 2026" / "05-Nov-2026" — only month names, never a lenient Date() guess.
  const named = /^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-,]+(\d{4})$/.exec(text)
  const month = named ? MONTHS.indexOf(named[2].slice(0, 3).toLowerCase()) : -1
  if (named && month >= 0) {
    const date = new Date(Date.UTC(Number(named[3]), month, Number(named[1])))
    if (date.getUTCDate() === Number(named[1])) return date.toISOString().slice(0, 10)
  }
  return null
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** Paste a text matrix starting at a cell: adds rows as needed and creates
 *  missing select options, like Baserow / Sheets. */
export function pasteText(grid: SynopsisGrid, rowIndex: number, visibleColumnIds: readonly string[], columnIndex: number, matrix: string[][]): SynopsisGrid {
  let next = grid
  while (next.rows.length < rowIndex + matrix.length && next.rows.length < GRID_LIMITS.rows) next = insertRow(next, next.rows.length)
  matrix.forEach((line, r) => {
    const row = next.rows[rowIndex + r]
    if (!row) return
    line.forEach((text, c) => {
      const columnId = visibleColumnIds[columnIndex + c]
      let column = next.columns.find(col => col.id === columnId)
      if (!column) return
      if ((column.type === 'singleSelect' || column.type === 'multiSelect') && text.trim()) {
        const missing = splitList(text, column.type).filter(part => !column!.options?.some(o => o.value.toLowerCase() === part.toLowerCase()))
        if (missing.length) {
          const options = [...(column.options ?? [])]
          for (const part of missing) if (options.length < GRID_LIMITS.options) options.push(makeOption(part, options.length))
          next = updateColumn(next, column.id, { options })
          column = next.columns.find(col => col.id === columnId)!
        }
      }
      next = setCell(next, row.id, column.id, parseCellText(column, text))
    })
  })
  return next
}

/** Tab-separated text as Sheets/Excel copy it: a cell holding a tab, line
 *  break or quote is wrapped in quotes, with "" for a literal quote. */
export function parseClipboard(text: string): string[][] {
  const input = text.replace(/\r\n?/g, '\n').replace(/\n$/, '')
  const rows: string[][] = [[]]
  let field = '', i = 0
  while (i <= input.length) {
    if (field === '' && input[i] === '"') {
      const end = (() => { for (let j = i + 1; j < input.length; j++) { if (input[j] === '"') { if (input[j + 1] === '"') j++; else return j } } return -1 })()
      const next = input[end + 1]
      if (end > 0 && (next === undefined || next === '\t' || next === '\n')) {
        field = input.slice(i + 1, end).replace(/""/g, '"'); i = end + 1
        continue
      }
    }
    const ch = input[i]
    if (ch === undefined || ch === '\t' || ch === '\n') {
      rows[rows.length - 1].push(field); field = ''
      if (ch === '\n') rows.push([])
      i++
      continue
    }
    field += ch; i++
  }
  return rows
}

export function sortRows(grid: SynopsisGrid, columnId: string, direction: 'asc' | 'desc'): SynopsisGrid {
  const column = grid.columns.find(col => col.id === columnId)
  if (!column) return grid
  const sign = direction === 'asc' ? 1 : -1
  const key = (row: GridRow) => {
    const value = row.cells[columnId]
    if (NUMBER_TYPES.includes(column.type)) return typeof value === 'number' ? value : null
    if (column.type === 'checkbox') return value === true ? 1 : 0
    if (column.type === 'singleSelect') { const index = column.options?.findIndex(o => o.id === value) ?? -1; return index < 0 ? null : index }
    const text = cellText(column, value)
    return text || null
  }
  const rows = [...grid.rows].sort((a, b) => {
    const x = key(a), y = key(b)
    if (x === null && y === null) return 0
    if (x === null) return 1
    if (y === null) return -1
    return (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true })) * sign
  })
  return { ...grid, rows }
}
