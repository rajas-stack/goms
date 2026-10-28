import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import type { WorkSheet } from 'xlsx'
import { Icon } from '@/components/ui/Icon'
import { cn } from '@/lib/utils'

type Xlsx = typeof import('xlsx')
/** Only what fits on screen is drawn; a bigger sheet says so and offers the download. */
const MAX_ROWS = 1000
const MAX_COLS = 100

export interface GridCell { key: string; text: string; numeric: boolean; rowSpan?: number; colSpan?: number }
export interface SheetGrid { columns: { label: string; width: number }[]; rows: { number: number; cells: GridCell[] }[]; truncated: boolean }

/** A worksheet as a grid: formatted cell text, merged cells, column widths, Excel's column letters and row numbers. */
export function sheetGrid(XLSX: Xlsx, sheet: WorkSheet): SheetGrid {
  const range = XLSX.utils.decode_range(sheet['!ref'] ?? 'A1:A1')
  const lastRow = Math.min(range.e.r, range.s.r + MAX_ROWS - 1)
  const lastCol = Math.min(range.e.c, range.s.c + MAX_COLS - 1)
  const spans = new Map<string, { rowSpan: number; colSpan: number }>()
  const covered = new Set<string>()
  for (const merge of sheet['!merges'] ?? []) {
    spans.set(`${merge.s.r}:${merge.s.c}`, { rowSpan: merge.e.r - merge.s.r + 1, colSpan: merge.e.c - merge.s.c + 1 })
    for (let r = merge.s.r; r <= merge.e.r; r++) for (let c = merge.s.c; c <= merge.e.c; c++) if (r !== merge.s.r || c !== merge.s.c) covered.add(`${r}:${c}`)
  }
  const columns = []
  for (let c = range.s.c; c <= lastCol; c++) {
    const width = sheet['!cols']?.[c]
    columns.push({ label: XLSX.utils.encode_col(c), width: Math.round(width?.wpx ?? (width?.wch ? width.wch * 7 + 5 : 72)) })
  }
  const rows = []
  for (let r = range.s.r; r <= lastRow; r++) {
    const cells: GridCell[] = []
    for (let c = range.s.c; c <= lastCol; c++) {
      const key = `${r}:${c}`
      if (covered.has(key)) continue
      const cell = sheet[XLSX.utils.encode_cell({ r, c })]
      const text = cell ? (cell.w ?? (cell.v instanceof Date ? cell.v.toLocaleDateString() : String(cell.v ?? ''))) : ''
      cells.push({ key, text, numeric: cell?.t === 'n', ...spans.get(key) })
    }
    rows.push({ number: r + 1, cells })
  }
  return { columns, rows, truncated: range.e.r > lastRow || range.e.c > lastCol }
}

/** An Excel workbook (also .xls, .csv, .ods) shown as a spreadsheet, with its sheets as tabs along the bottom. */
export function SheetPreview({ id, blob }: { id: string; blob: Blob }) {
  const book = useQuery({
    queryKey: ['whatsapp', 'sheet', id], staleTime: Infinity, retry: false,
    queryFn: async () => {
      const XLSX = await import('xlsx')
      return { XLSX, workbook: XLSX.read(await blob.arrayBuffer(), { type: 'array', cellDates: true }) }
    },
  })
  const [index, setIndex] = useState(0)
  if (book.isPending) return <Loading text="Opening the workbook…" />
  if (book.isError) return <Failed text={`Could not read this workbook: ${book.error.message}`} />
  const { XLSX, workbook } = book.data
  const name = workbook.SheetNames[index] ?? workbook.SheetNames[0]
  const grid = sheetGrid(XLSX, workbook.Sheets[name])
  const edge = 'border-b border-r border-line'
  return (
    <div className="flex h-full w-full flex-col overflow-hidden rounded-lg bg-white text-ink">
      <div className="min-h-0 flex-1 overflow-auto">
        <table aria-label={`Sheet ${name}`} className="border-separate border-spacing-0 text-[12px]" style={{ tableLayout: 'fixed' }}>
          <colgroup><col style={{ width: 44 }} />{grid.columns.map((column) => <col key={column.label} style={{ width: column.width }} />)}</colgroup>
          <thead>
            <tr>
              <th className={cn(edge, 'sticky left-0 top-0 z-20 bg-panel')} />
              {grid.columns.map((column) => <th key={column.label} scope="col" className={cn(edge, 'sticky top-0 z-10 bg-panel px-1 py-0.5 font-medium text-muted')}>{column.label}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.rows.map((row) => (
              <tr key={row.number}>
                <th scope="row" className={cn(edge, 'sticky left-0 z-10 bg-panel px-1 text-right font-normal tabular-nums text-muted')}>{row.number}</th>
                {row.cells.map((cell) => (
                  <td key={cell.key} rowSpan={cell.rowSpan} colSpan={cell.colSpan} title={cell.text.length > 24 ? cell.text : undefined}
                    className={cn('overflow-hidden text-ellipsis whitespace-nowrap border-b border-r border-line/60 px-1.5 py-0.5', cell.numeric && 'text-right tabular-nums')}>
                    {cell.text}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {grid.truncated && <p className="border-t border-line px-3 py-1 text-[12px] text-muted">Showing the first {MAX_ROWS.toLocaleString()} rows and {MAX_COLS} columns. Download the file for the whole sheet.</p>}
      <div role="tablist" aria-label="Sheets" className="flex shrink-0 gap-0.5 overflow-x-auto border-t border-line bg-panel px-2">
        {workbook.SheetNames.map((sheet, sheetIndex) => (
          <button key={sheet} type="button" role="tab" aria-selected={sheet === name} onClick={() => setIndex(sheetIndex)}
            className={cn('shrink-0 border-b-2 px-3 py-1.5 text-[12px] transition', sheet === name ? 'border-emerald-600 bg-white font-semibold text-ink' : 'border-transparent text-muted hover:text-ink')}>
            {sheet}
          </button>
        ))}
      </div>
    </div>
  )
}

/** A Word document laid out as Word does (pages, headers, tables, images). It is drawn into a sandboxed frame with scripts off,
 *  so nothing in a file someone sent can run inside GOMS; its links open in a new tab. */
export function WordPreview({ blob, filename }: { blob: Blob; filename: string }) {
  const [html, setHtml] = useState<string>()
  const [error, setError] = useState<string>()
  useEffect(() => {
    let current = true
    void (async () => {
      const { renderAsync } = await import('docx-preview')
      const container = document.createElement('div')
      await renderAsync(blob, container, container, {
        inWrapper: true, breakPages: true, ignoreLastRenderedPageBreak: true, useBase64URL: true,
        renderHeaders: true, renderFooters: true, renderFootnotes: true, renderEndnotes: true,
      })
      if (current) setHtml(container.innerHTML)
    })().catch((failure: Error) => { if (current) setError(failure.message) })
    return () => { current = false }
  }, [blob])
  if (error) return <Failed text={`Could not read this document: ${error}`} />
  if (!html) return <Loading text="Opening the document…" />
  return (
    <iframe title={filename} sandbox="allow-popups allow-popups-to-escape-sandbox" className="h-full w-full rounded-lg bg-white"
      srcDoc={`<!doctype html><html><head><meta charset="utf-8"><base target="_blank"></head><body style="margin:0">${html}</body></html>`} />
  )
}

/** A plain-text file as it is. */
export function TextPreview({ blob }: { blob: Blob }) {
  const [text, setText] = useState<string>()
  useEffect(() => { void blob.text().then(setText) }, [blob])
  if (text === undefined) return <Loading text="Opening…" />
  return <pre className="h-full w-full overflow-auto whitespace-pre-wrap break-words rounded-lg bg-white p-4 text-[13px] text-ink">{text}</pre>
}

function Loading({ text }: { text: string }) {
  return <p className="flex items-center gap-2 text-white/85"><Icon name="Loader" className="animate-spin" />{text}</p>
}

function Failed({ text }: { text: string }) {
  return <p className="max-w-md text-center text-white/85">{text} You can still download the file.</p>
}
