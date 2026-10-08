import { useEffect, useRef, useState } from 'react'
import { read, utils, writeFileXLSX, type WorkBook } from 'xlsx'
import { validateSynopsisDocument, type BidSynopsis, type BidSynopsisSection, type SynopsisGrid, type PolicyModuleKey } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Select, Textarea } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Menu } from '@/components/ui/Menu'
import { cn } from '@/lib/utils'
import { useAllowed } from '@/lib/permissions'
import { useSaveSynopsis, useSynopsis } from '../api'
import { SECTION_LABELS } from '../documents'
import { gridDocument, gridToWorksheet, readGridSection, worksheetToGrid } from './gridIO'
import { updateColumn } from './gridModel'
import { SynopsisGridView } from './SynopsisGridView'

const HISTORY_LIMIT = 100
const DRAFT_DELAY_MS = 500

interface Draft { grid: SynopsisGrid; notes: string; revision: number }
function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw) as Draft
    validateSynopsisDocument(gridDocument(draft.grid, draft.notes))
    return Number.isInteger(draft.revision) && draft.revision >= 0 ? draft : null
  } catch { return null }
}

export function GridTab({ bidId, section, module = 'opp.bidTracker' }: { bidId: string; section: BidSynopsisSection; module?: PolicyModuleKey }) {
  const query = useSynopsis(bidId, section)
  const canEdit = useAllowed(module, 'update')
  if (query.isLoading) return <div role="status" className="p-6 text-sm text-muted">Loading {SECTION_LABELS[section]}...</div>
  if (query.isError) return <div role="alert" className="space-y-2 p-6 text-sm text-crimson"><p>{query.error.message}</p><Button size="sm" onClick={() => query.refetch()}>Retry</Button></div>
  return <GridSectionEditor key={`${bidId}:${section}:${canEdit}`} bidId={bidId} section={section} saved={query.data ?? null} canEdit={canEdit} onReload={() => query.refetch()} />
}

function GridSectionEditor({ bidId, section, saved, canEdit, onReload }: {
  bidId: string; section: BidSynopsisSection; saved: BidSynopsis | null; canEdit: boolean; onReload: () => Promise<{ data?: BidSynopsis | null; error?: unknown }>
}) {
  const label = SECTION_LABELS[section]
  const draftKey = `goms:synopsis-grid:${import.meta.env.VITE_API_BASE_URL || 'local'}:${bidId}:${section}`
  const [initial] = useState(() => {
    const loaded = readGridSection(saved?.document)
    const draft = canEdit ? readDraft(draftKey) : null
    return { loaded, draft }
  })
  const [grid, setGrid] = useState<SynopsisGrid>(initial.draft?.grid ?? initial.loaded.grid)
  const [notes, setNotes] = useState(initial.draft?.notes ?? initial.loaded.notes)
  const [converted, setConverted] = useState(initial.loaded.converted)
  const revision = useRef(initial.draft?.revision ?? saved?.revision ?? 0)
  const savedJson = useRef(JSON.stringify(gridDocument(initial.loaded.grid, initial.loaded.notes)))
  const [history, setHistory] = useState<{ past: SynopsisGrid[]; future: SynopsisGrid[] }>({ past: [], future: [] })
  const [error, setError] = useState<string | null>(null)
  const [importBook, setImportBook] = useState<{ book: WorkBook; filename: string } | null>(null)
  const [importSheet, setImportSheet] = useState('')
  const upload = useRef<HTMLInputElement>(null)
  const save = useSaveSynopsis()

  const currentJson = JSON.stringify(gridDocument(grid, notes))
  const dirty = currentJson !== savedJson.current || converted

  useEffect(() => {
    if (!canEdit) return
    // Debounced: a large grid is ~1 MB of JSON, too much to write per keystroke.
    const timer = setTimeout(() => {
      try {
        if (currentJson !== savedJson.current) sessionStorage.setItem(draftKey, JSON.stringify({ grid, notes, revision: revision.current }))
        else sessionStorage.removeItem(draftKey)
      } catch { /* Saving still works when browser storage is restricted. */ }
    }, DRAFT_DELAY_MS)
    return () => clearTimeout(timer)
  }, [canEdit, currentJson, draftKey, grid, notes])
  useEffect(() => {
    if (!canEdit || !dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [canEdit, dirty])

  // Ref, not state: two edits in one event (new dropdown option + the cell
  // using it) must each record the grid the other produced.
  const gridRef = useRef(grid)
  const commitGrid = (next: SynopsisGrid) => { gridRef.current = next; setGrid(next) }
  const change = (next: SynopsisGrid) => {
    if (!canEdit) return
    setError(null)
    const previous = gridRef.current
    setHistory(h => ({ past: [...h.past, previous].slice(-HISTORY_LIMIT), future: [] }))
    commitGrid(next)
  }
  const undo = () => {
    if (!canEdit || !history.past.length) return
    setHistory({ past: history.past.slice(0, -1), future: [gridRef.current, ...history.future] })
    commitGrid(history.past[history.past.length - 1])
  }
  const redo = () => {
    if (!canEdit || !history.future.length) return
    setHistory({ past: [...history.past, gridRef.current], future: history.future.slice(1) })
    commitGrid(history.future[0])
  }

  const saveSection = async () => {
    if (!canEdit || save.isPending) return
    setError(null)
    try {
      const document = gridDocument(grid, notes)
      validateSynopsisDocument(document)
      const record = await save.mutateAsync({ bidId, section, document, expectedRevision: revision.current })
      revision.current = record.revision
      // The server stores jsonb (keys reordered): compare against what was sent.
      savedJson.current = JSON.stringify(document)
      setConverted(false)
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not save this section.') }
  }

  const reload = async () => {
    if (dirty && !window.confirm(`Discard your unsaved changes and reload ${label}?`)) return
    setError(null)
    const result = await onReload()
    if (result.error) { setError('Could not reload the saved section. Your changes have been kept.'); return }
    const loaded = readGridSection(result.data?.document)
    revision.current = result.data?.revision ?? 0
    savedJson.current = JSON.stringify(gridDocument(loaded.grid, loaded.notes))
    commitGrid(loaded.grid); setNotes(loaded.notes); setConverted(loaded.converted); setHistory({ past: [], future: [] })
  }

  const exportSheet = () => {
    const book = utils.book_new()
    utils.book_append_sheet(book, gridToWorksheet(grid, notes), label.slice(0, 31))
    writeFileXLSX(book, `${label.replace(/ /g, '-')}-${bidId}.xlsx`)
  }
  const loadWorkbook = async (file: File) => {
    if (!canEdit) return
    setError(null)
    if (file.size > 10_000_000) { setError('Choose an Excel workbook smaller than 10 MB.'); return }
    try {
      // sheetRows caps parsing so an oversized sheet cannot freeze the tab.
      const book = read(await file.arrayBuffer(), { cellNF: true, sheetRows: 1002 })
      setImportBook({ book, filename: file.name }); setImportSheet(book.SheetNames[0])
    } catch { setError('This workbook could not be read. Choose a valid .xlsx or .xls file.') }
  }
  const importGrid = () => {
    if (!canEdit || !importBook) return
    try { change(worksheetToGrid(importBook.book.Sheets[importSheet])); setImportBook(null) } catch (e) { setError(e instanceof Error ? e.message : 'Could not import this sheet.') }
  }

  const hidden = grid.columns.filter(c => c.hidden).length
  return (
    <section className="min-w-0" aria-label={label}>
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
        <div className="flex flex-wrap items-center gap-3">
          <h2 className="text-base font-semibold text-ink-900">{label}</h2>
          <span role="status" className={cn('inline-flex items-center gap-1.5 text-[12px]', dirty ? 'text-amber' : 'text-muted')}>
            {save.isPending ? <><Icon name="Loader" size={12} className="animate-spin" /> Saving...</>
              : dirty ? <><span className="h-1.5 w-1.5 rounded-full bg-amber" /> Unsaved changes</>
                : saved || revision.current ? <><Icon name="Check" size={12} className="text-emerald" /> Saved</> : 'Not saved yet'}
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Button size="sm" aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canEdit || !history.past.length} onClick={undo}><Icon name="RotateCcw" size={14} /></Button>
          <Button size="sm" aria-label="Redo" title="Redo (Ctrl+Y)" disabled={!canEdit || !history.future.length} onClick={redo}><Icon name="RotateCcw" size={14} className="-scale-x-100" /></Button>
          <Menu trigger={({ toggle }) => (
            <Button size="sm" disabled={!canEdit} onClick={toggle} className={cn(hidden > 0 && 'border-goms-sky text-goms-navy')}>
              <Icon name="EyeOff" size={14} /> {hidden ? `${hidden} hidden` : 'Hide columns'}
            </Button>
          )}>
            <div className="max-h-72 space-y-0.5 overflow-y-auto p-1">
              {grid.columns.map(column => (
                <label key={column.id} className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] hover:bg-ink-900/[0.05]">
                  <input type="checkbox" checked={!column.hidden}
                    disabled={!column.hidden && grid.columns.filter(c => !c.hidden).length <= 1}
                    onChange={() => change(updateColumn(grid, column.id, { hidden: !column.hidden }))} />
                  <span className="truncate">{column.name}</span>
                </label>
              ))}
            </div>
          </Menu>
          <Button size="sm" aria-label="Reload saved section" title="Reload saved section" disabled={save.isPending} onClick={() => void reload()}><Icon name="History" size={14} /></Button>
          <Button size="sm" title="Import Excel sheet" disabled={!canEdit || save.isPending} onClick={() => upload.current?.click()}><Icon name="Upload" size={14} /> Import</Button>
          <Button size="sm" title="Export to Excel" onClick={exportSheet}><Icon name="Download" size={14} /> Export</Button>
          <Button size="sm" variant="primary" disabled={!canEdit || save.isPending || !dirty} onClick={() => void saveSection()}><Icon name="Check" size={14} /> Save</Button>
          <input ref={upload} type="file" accept=".xlsx,.xls,.csv" aria-label="Excel workbook" className="hidden" onChange={event => {
            const file = event.target.files?.[0]; if (file) void loadWorkbook(file); event.target.value = ''
          }} />
        </div>
      </div>
      {initial.draft && dirty && <div className="px-4 pb-2 text-[12px] text-amber">Unsaved draft restored.</div>}
      {converted && (
        <div role="note" className="mx-4 mb-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] text-ink">
          This section was upgraded from the older table format: the first table is now the grid; any other text and tables are in Notes. Review and Save to keep it.
        </div>
      )}
      {error && <div role="alert" className="border-y border-red-200 bg-red-50 px-4 py-2 text-[13px] text-crimson">{error}</div>}
      <SynopsisGridView grid={grid} readOnly={!canEdit} onChange={change} label={`${label} grid`} onUndo={undo} onRedo={redo} onError={setError} />
      <p className="px-4 py-1.5 text-[11px] text-muted">
        Double-click or type to edit · Drag row numbers or headers to reorder · Right-click for row/column actions · Ctrl+C / Ctrl+V work with Sheets and Excel
      </p>
      <label className="block px-4 pb-4 pt-2">
        <span className="mb-1.5 block text-[13px] font-medium text-ink-800">Notes</span>
        <Textarea value={notes} readOnly={!canEdit} onChange={event => setNotes(event.target.value)} rows={4} placeholder={`Anything about ${label} that does not fit the grid`} />
      </label>
      <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
        <span>Revision {revision.current}</span>
        {saved?.updatedAt && <span>Saved {new Date(saved.updatedAt).toLocaleString('en-IN')}</span>}
        {saved?.updatedBy && <span>{saved.updatedBy}</span>}
      </div>
      <Dialog open={!!importBook} onClose={() => setImportBook(null)} title="Import Excel sheet" footer={<>
        <Button size="sm" onClick={() => setImportBook(null)}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={importGrid}><Icon name="Upload" size={14} /> Replace grid</Button>
      </>}>
        <div className="space-y-3 text-[13px]">
          <p className="break-words font-medium">{importBook?.filename}</p>
          <label className="block text-muted">Worksheet
            <Select aria-label="Worksheet" className="mt-1" value={importSheet} onChange={event => setImportSheet(event.target.value)}>
              {importBook?.book.SheetNames.map(name => <option key={name} value={name}>{name}</option>)}
            </Select>
          </label>
          <p className="text-muted">The first row becomes the column names. The current grid is replaced (Undo restores it).</p>
          {error && <p role="alert" className="text-crimson">{error}</p>}
        </div>
      </Dialog>
    </section>
  )
}
