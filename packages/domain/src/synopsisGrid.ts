/** Baserow-style structured grid stored inside a synopsis section document as
 *  a single `{ type: 'grid', attrs: { grid } }` node. Typed columns (fields),
 *  ordered rows, cell values keyed by column id. */

export const GRID_FIELD_TYPES = [
  'text', 'longText', 'number', 'currency', 'percent', 'date', 'singleSelect', 'multiSelect', 'checkbox', 'url',
] as const
export type GridFieldType = (typeof GRID_FIELD_TYPES)[number]

export const GRID_OPTION_COLORS = ['blue', 'emerald', 'amber', 'crimson', 'purple', 'gray'] as const
export type GridOptionColor = (typeof GRID_OPTION_COLORS)[number]

export interface GridSelectOption { id: string; value: string; color: GridOptionColor }

export interface GridColumn {
  id: string
  name: string
  type: GridFieldType
  /** px; undefined = default width. */
  width?: number
  hidden?: boolean
  /** Choices for singleSelect / multiSelect. */
  options?: GridSelectOption[]
}

/** text-like types hold strings, number types numbers, checkbox booleans,
 *  singleSelect an option id, multiSelect option ids. */
export type GridCellValue = string | number | boolean | string[] | null

export interface GridRow { id: string; cells: Record<string, GridCellValue> }

export interface SynopsisGrid {
  columns: GridColumn[]
  rows: GridRow[]
  /** Leading visible columns kept in view while scrolling sideways. */
  frozenColumns?: number
}

export const GRID_LIMITS = { columns: 50, rows: 1000, text: 10_000, options: 100, name: 120 } as const

const isObject = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)
const isId = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{1,40}$/.test(value)

function validateCell(column: GridColumn, value: unknown): void {
  if (value === null || value === undefined) return
  const fail = () => { throw new Error(`Invalid value in column "${column.name}".`) }
  switch (column.type) {
    case 'number': case 'currency': case 'percent':
      if (typeof value !== 'number' || !Number.isFinite(value)) fail(); return
    case 'checkbox':
      if (typeof value !== 'boolean') fail(); return
    case 'singleSelect':
      if (typeof value !== 'string' || !column.options?.some(o => o.id === value)) fail(); return
    case 'multiSelect':
      if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || !column.options?.some(o => o.id === v))) fail(); return
    case 'date':
      if (typeof value !== 'string' || (value !== '' && !/^\d{4}-\d{2}-\d{2}$/.test(value))) fail(); return
    case 'url':
      if (typeof value !== 'string' || value.length > GRID_LIMITS.text || (value !== '' && !/^(https?:|mailto:)/i.test(value))) fail(); return
    default:
      if (typeof value !== 'string' || value.length > GRID_LIMITS.text) fail()
  }
}

export function validateSynopsisGrid(value: unknown): asserts value is SynopsisGrid {
  if (!isObject(value) || !Array.isArray(value.columns) || !Array.isArray(value.rows)) throw new Error('Invalid grid.')
  if (!value.columns.length || value.columns.length > GRID_LIMITS.columns) throw new Error(`A grid needs 1 to ${GRID_LIMITS.columns} columns.`)
  if (value.rows.length > GRID_LIMITS.rows) throw new Error(`A grid can hold up to ${GRID_LIMITS.rows} rows.`)
  const columnIds = new Set<string>()
  for (const column of value.columns as unknown[]) {
    if (!isObject(column) || !isId(column.id) || columnIds.has(column.id)) throw new Error('Invalid grid column.')
    columnIds.add(column.id)
    if (typeof column.name !== 'string' || column.name.length > GRID_LIMITS.name) throw new Error('Invalid column name.')
    if (!GRID_FIELD_TYPES.includes(column.type as GridFieldType)) throw new Error('Invalid column type.')
    if (column.width !== undefined && (typeof column.width !== 'number' || column.width < 40 || column.width > 1200)) throw new Error('Invalid column width.')
    if (column.hidden !== undefined && typeof column.hidden !== 'boolean') throw new Error('Invalid column visibility.')
    if (column.options !== undefined) {
      if (!Array.isArray(column.options) || column.options.length > GRID_LIMITS.options) throw new Error('Invalid column options.')
      const optionIds = new Set<string>()
      for (const option of column.options as unknown[]) {
        if (!isObject(option) || !isId(option.id) || optionIds.has(option.id) || typeof option.value !== 'string' || option.value.length > GRID_LIMITS.name
          || !GRID_OPTION_COLORS.includes(option.color as GridOptionColor)) throw new Error('Invalid column option.')
        optionIds.add(option.id)
      }
    }
  }
  const rowIds = new Set<string>()
  const columns = value.columns as GridColumn[]
  for (const row of value.rows as unknown[]) {
    if (!isObject(row) || !isId(row.id) || rowIds.has(row.id) || !isObject(row.cells)) throw new Error('Invalid grid row.')
    rowIds.add(row.id)
    for (const key of Object.keys(row.cells)) if (!columnIds.has(key)) throw new Error('Grid row references an unknown column.')
    for (const column of columns) validateCell(column, row.cells[column.id])
  }
  if (value.frozenColumns !== undefined && (!Number.isInteger(value.frozenColumns) || Number(value.frozenColumns) < 0 || Number(value.frozenColumns) > 5)) {
    throw new Error('Invalid frozen columns.')
  }
}
