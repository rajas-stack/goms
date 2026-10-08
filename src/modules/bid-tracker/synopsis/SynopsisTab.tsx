import { useEffect, useRef, useState, type ReactNode } from 'react'
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react'
import {
  AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline, Strikethrough,
  List, ListOrdered, Undo2, Redo2, WrapText, Merge, Split, Rows3, Columns3,
  Table2, Plus, Trash2, Highlighter, Save, Upload, Download, Eye, Pencil,
  RotateCcw, Check, Loader2, type LucideIcon,
} from 'lucide-react'
import { read, utils, writeFileXLSX, type WorkBook } from 'xlsx'
import { validateSynopsisDocument, type BidSynopsis, type BidSynopsisSection, type PolicyModuleKey, type SynopsisNode } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Can, useAllowed } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { useSaveSynopsis, useSynopsis } from './api'
import { createTable, documentToWorksheet, SECTION_LABELS, starterDocument, worksheetToDocument } from './documents'
import { formatNumericCells, selectCells, synopsisExtensions } from './extensions'
import './synopsis.css'

const field = 'h-8 rounded-md border border-line bg-white px-2 text-[12px] text-ink focus-visible:focus-ring'
const FILLS = [null, '#fff2cc', '#d9ead3', '#cfe2f3', '#f4cccc', '#ead1dc', '#d9d2e9', '#eeeeee']

function Tool({ icon: Icon, label, onClick, active = false, disabled = false }: {
  icon: LucideIcon; label: string; onClick: () => void; active?: boolean; disabled?: boolean
}) {
  return <button type="button" title={label} aria-label={label} aria-pressed={active} disabled={disabled}
    onMouseDown={event => event.preventDefault()} onClick={onClick}
    className={cn('flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted hover:bg-panel hover:text-ink focus-visible:focus-ring disabled:opacity-35', active && 'bg-blue-100 text-blue')}>
    <Icon size={16} strokeWidth={1.8} />
  </button>
}

function Group({ children }: { children: ReactNode }) {
  return <span className="flex items-center gap-0.5 border-r border-line pr-2 last:border-0">{children}</span>
}

function Toolbar({ editor, onInsert, onError }: { editor: Editor; onInsert: () => void; onError: (message: string | null) => void }) {
  const state = useEditorState({ editor, selector: ({ editor }) => ({
    table: editor.isActive('table'), bold: editor.isActive('bold'), italic: editor.isActive('italic'),
    underline: editor.isActive('underline'), strike: editor.isActive('strike'), bullet: editor.isActive('bulletList'),
    ordered: editor.isActive('orderedList'), highlight: editor.isActive('highlight'),
    heading: editor.getAttributes('heading').level ?? 0,
    format: editor.getAttributes('tableCell').cellFormat ?? editor.getAttributes('tableHeader').cellFormat ?? 'text',
    wrap: editor.getAttributes('tableCell').wrap ?? editor.getAttributes('tableHeader').wrap ?? true,
    fontSize: editor.getAttributes('textStyle').fontSize ?? '13px',
    fontFamily: editor.getAttributes('textStyle').fontFamily ?? 'IBM Plex Sans',
    undo: editor.can().undo(), redo: editor.can().redo(), merge: editor.can().mergeCells(), split: editor.can().splitCell(),
    from: editor.state.selection.from, to: editor.state.selection.to,
  }) })
  return <div className="synopsis-toolbar border-y border-line bg-white px-3 py-2">
    <div role="toolbar" aria-label="Text formatting" className="flex flex-wrap items-center gap-x-2 gap-y-1">
      <Group>
        <Tool icon={Undo2} label="Undo" disabled={!state.undo} onClick={() => editor.chain().focus().undo().run()} />
        <Tool icon={Redo2} label="Redo" disabled={!state.redo} onClick={() => editor.chain().focus().redo().run()} />
      </Group>
      <Group>
        <select aria-label="Paragraph style" className={`${field} w-28`} value={state.heading}
          onChange={event => { const level = Number(event.target.value); level ? editor.chain().focus().setHeading({ level: level as 1 | 2 | 3 }).run() : editor.chain().focus().setParagraph().run() }}>
          <option value="0">Normal text</option><option value="1">Heading 1</option><option value="2">Heading 2</option><option value="3">Heading 3</option>
        </select>
        <select aria-label="Font family" className={`${field} w-28`} onChange={event => editor.chain().focus().setFontFamily(event.target.value).run()} value={state.fontFamily}>
          <option>IBM Plex Sans</option><option>Arial</option><option>Times New Roman</option><option>Courier New</option>
        </select>
        <select aria-label="Font size" value={state.fontSize} className={`${field} w-16`} onChange={event => editor.chain().focus().setFontSize(event.target.value).run()}>
          {[11, 12, 13, 14, 16, 18, 22, 28].map(size => <option key={size} value={`${size}px`}>{size}</option>)}
        </select>
      </Group>
      <Group>
        <Tool icon={Bold} label="Bold" active={state.bold} onClick={() => editor.chain().focus().toggleBold().run()} />
        <Tool icon={Italic} label="Italic" active={state.italic} onClick={() => editor.chain().focus().toggleItalic().run()} />
        <Tool icon={Underline} label="Underline" active={state.underline} onClick={() => editor.chain().focus().toggleUnderline().run()} />
        <Tool icon={Strikethrough} label="Strikethrough" active={state.strike} onClick={() => editor.chain().focus().toggleStrike().run()} />
        <label title="Text color" className="flex h-8 w-8 items-center justify-center">
          <input type="color" aria-label="Text color" className="h-5 w-5 cursor-pointer border-0 bg-transparent p-0" defaultValue="#1a2332" onChange={event => editor.chain().focus().setColor(event.target.value).run()} />
        </label>
        <Tool icon={Highlighter} label="Highlight text" active={state.highlight} onClick={() => editor.chain().focus().toggleHighlight({ color: '#fff2cc' }).run()} />
      </Group>
      <Group>
        <Tool icon={AlignLeft} label="Align left" onClick={() => editor.chain().focus().setTextAlign('left').run()} />
        <Tool icon={AlignCenter} label="Align center" onClick={() => editor.chain().focus().setTextAlign('center').run()} />
        <Tool icon={AlignRight} label="Align right" onClick={() => editor.chain().focus().setTextAlign('right').run()} />
        <Tool icon={List} label="Bullet list" active={state.bullet} onClick={() => editor.chain().focus().toggleBulletList().run()} />
        <Tool icon={ListOrdered} label="Numbered list" active={state.ordered} onClick={() => editor.chain().focus().toggleOrderedList().run()} />
      </Group>
    </div>
    <div role="toolbar" aria-label="Table formatting" className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-line pt-2">
      <Button size="sm" onMouseDown={event => event.preventDefault()} onClick={onInsert}><Table2 size={14} /> Insert table</Button>
      <Group>
        <Tool icon={Rows3} label="Select row" disabled={!state.table} onClick={() => selectCells(editor, 'row')} />
        <Tool icon={Columns3} label="Select column" disabled={!state.table} onClick={() => selectCells(editor, 'column')} />
        <Tool icon={Plus} label="Add row below" disabled={!state.table} onClick={() => editor.chain().focus().addRowAfter().run()} />
        <Tool icon={Plus} label="Add column right" disabled={!state.table} onClick={() => editor.chain().focus().addColumnAfter().run()} />
        <Tool icon={Trash2} label="Delete row" disabled={!state.table} onClick={() => editor.chain().focus().deleteRow().run()} />
        <Tool icon={Trash2} label="Delete column" disabled={!state.table} onClick={() => editor.chain().focus().deleteColumn().run()} />
      </Group>
      <Group>
        <Tool icon={Merge} label="Merge selected cells" disabled={!state.merge} onClick={() => editor.chain().focus().mergeCells().run()} />
        <Tool icon={Split} label="Split cell" disabled={!state.split} onClick={() => editor.chain().focus().splitCell().run()} />
        <Tool icon={WrapText} label="Wrap cell text" disabled={!state.table} active={state.wrap} onClick={() => editor.chain().focus().setCellAttribute('wrap', !state.wrap).run()} />
        <Tool icon={Table2} label="Toggle header row" disabled={!state.table} onClick={() => editor.chain().focus().toggleHeaderRow().run()} />
      </Group>
      <select aria-label="Cell number format" value={state.format} disabled={!state.table} className={`${field} w-28 disabled:opacity-40`}
        onChange={event => { onError(null); try { formatNumericCells(editor, event.target.value) } catch (error) { onError(error instanceof Error ? error.message : 'Could not format cells.') } }}>
        <option value="text">Text</option><option value="number">Number</option><option value="currency">INR currency</option><option value="percent">Percentage</option>
      </select>
      <Group>
        {FILLS.map((color, index) => <button key={index} type="button" aria-label={color ? `Fill ${color}` : 'Clear cell fill'} title={color ? `Cell fill ${color}` : 'Clear cell fill'} disabled={!state.table}
          onMouseDown={event => event.preventDefault()} onClick={() => editor.chain().focus().setCellAttribute('backgroundColor', color).run()}
          className="flex h-6 w-6 shrink-0 items-center justify-center rounded border border-line disabled:opacity-35" style={{ backgroundColor: color ?? undefined }}>
          {!color && <RotateCcw size={12} />}
        </button>)}
      </Group>
    </div>
  </div>
}

interface Draft { document: SynopsisNode; revision: number }
function readDraft(key: string): Draft | null {
  try {
    const raw = sessionStorage.getItem(key)
    if (!raw) return null
    const draft = JSON.parse(raw)
    validateSynopsisDocument(draft.document)
    if (!Number.isInteger(draft.revision) || draft.revision < 0) return null
    return draft
  } catch { return null }
}

/** `module` is the sheet module the bid lives on: saving a section needs full write access there (the server's rule for
 *  `bidSynopsis.save`); reading follows the bid detail view. Without it the section opens as a read-only document. */
export function SynopsisTab({ bidId, section, module }: { bidId: string; section: BidSynopsisSection; module: PolicyModuleKey }) {
  const query = useSynopsis(bidId, section)
  if (query.isLoading) return <div role="status" className="p-6 text-sm text-muted">Loading {SECTION_LABELS[section]}...</div>
  if (query.isError) return <div role="alert" className="space-y-2 p-6 text-sm text-crimson"><p>{query.error.message}</p><Button size="sm" onClick={() => query.refetch()}>Retry</Button></div>
  return <SynopsisDocumentEditor key={`${bidId}:${section}`} bidId={bidId} section={section} saved={query.data ?? null} module={module} onReload={() => query.refetch()} />
}

function SynopsisDocumentEditor({ bidId, section, saved, module, onReload }: {
  bidId: string; section: BidSynopsisSection; saved: BidSynopsis | null; module: PolicyModuleKey; onReload: () => Promise<{ data?: BidSynopsis | null; error?: unknown }>
}) {
  const draftKey = `goms:synopsis:${import.meta.env.VITE_API_BASE_URL || 'local'}:${bidId}:${section}`
  const canEdit = useAllowed(module, 'update')
  const [initial] = useState(() => (canEdit ? readDraft(draftKey) : null))
  const revision = useRef(initial?.revision ?? saved?.revision ?? 0)
  const savedJson = useRef(JSON.stringify(saved?.document ?? starterDocument(section)))
  const [dirty, setDirty] = useState(!!initial && JSON.stringify(initial.document) !== savedJson.current)
  const [error, setError] = useState<string | null>(null)
  const [draftWarning, setDraftWarning] = useState<string | null>(null)
  const [readOnly, setReadOnly] = useState(false)
  const [inserting, setInserting] = useState(false)
  const [headerRow, setHeaderRow] = useState(true)
  const [rowCount, setRowCount] = useState(3)
  const [columnCount, setColumnCount] = useState(4)
  const [importBook, setImportBook] = useState<{ book: WorkBook; filename: string } | null>(null)
  const [importSheet, setImportSheet] = useState('')
  const [importMode, setImportMode] = useState<'append' | 'replace'>('append')
  const upload = useRef<HTMLInputElement>(null)
  const save = useSaveSynopsis()
  const editor = useEditor({
    editable: canEdit, extensions: synopsisExtensions(), content: initial?.document ?? saved?.document ?? starterDocument(section),
    editorProps: { attributes: { role: 'textbox', 'aria-label': `${SECTION_LABELS[section]} document`, 'aria-multiline': 'true', spellcheck: 'true' } },
    onUpdate: ({ editor }) => {
      const document = editor.getJSON() as SynopsisNode
      const changed = JSON.stringify(document) !== savedJson.current
      setDirty(changed)
      try {
        if (changed) sessionStorage.setItem(draftKey, JSON.stringify({ document, revision: revision.current }))
        else sessionStorage.removeItem(draftKey)
        setDraftWarning(null)
      } catch { setDraftWarning('Draft backup is unavailable. Save your changes before leaving this page.') }
    },
  })

  useEffect(() => { editor?.setEditable(canEdit && !readOnly) }, [editor, readOnly, canEdit])
  useEffect(() => {
    if (!dirty) return
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const saveDocument = async () => {
    if (!editor || save.isPending) return
    const document = editor.getJSON() as SynopsisNode
    setError(null)
    try {
      validateSynopsisDocument(document)
      const record = await save.mutateAsync({ bidId, section, document, expectedRevision: revision.current })
      revision.current = record.revision
      savedJson.current = JSON.stringify(record.document)
      const current = editor.getJSON() as SynopsisNode
      const changed = JSON.stringify(current) !== savedJson.current
      setDirty(changed)
      try {
        if (changed) sessionStorage.setItem(draftKey, JSON.stringify({ document: current, revision: revision.current }))
        else sessionStorage.removeItem(draftKey)
      } catch { setDraftWarning('Draft backup is unavailable.') }
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not save this section.') }
  }

  const reload = async () => {
    if (dirty && !window.confirm('Discard your unsaved changes and reload this section?')) return
    setError(null)
    const result = await onReload()
    if (result.error) { setError('Could not reload the saved section. Your draft has been kept.'); return }
    const document = result.data?.document ?? starterDocument(section)
    revision.current = result.data?.revision ?? 0
    savedJson.current = JSON.stringify(document)
    editor?.commands.setContent(document)
    setDirty(false)
    try { sessionStorage.removeItem(draftKey) } catch { /* Saving still works when browser storage is restricted. */ }
  }

  const exportDocument = () => {
    if (!editor) return
    const book = utils.book_new()
    utils.book_append_sheet(book, documentToWorksheet(editor.getJSON() as SynopsisNode), SECTION_LABELS[section])
    writeFileXLSX(book, `${SECTION_LABELS[section].replace(/ /g, '-')}-${bidId}.xlsx`)
  }

  const loadWorkbook = async (file: File) => {
    setError(null)
    if (file.size > 10_000_000) { setError('Choose an Excel workbook smaller than 10 MB.'); return }
    try {
      const book = read(await file.arrayBuffer(), { cellStyles: true, cellNF: true })
      setImportBook({ book, filename: file.name }); setImportSheet(book.SheetNames[0]); setImportMode('append')
    } catch { setError('This workbook could not be read. Choose a valid .xlsx or .xls file.') }
  }

  const importDocument = () => {
    if (!importBook || !editor) return
    setError(null)
    try {
      const document = worksheetToDocument(importBook.book.Sheets[importSheet], section === 'scope')
      validateSynopsisDocument(document)
      if (importMode === 'replace') editor.commands.setContent(document)
      else editor.chain().focus('end').insertContent([paragraphSpacer(), ...document.content!]).run()
      setImportBook(null)
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not import this sheet.') }
  }

  if (!editor) return null
  return <section className="min-w-0" aria-label={SECTION_LABELS[section]}>
    <div className="synopsis-actions flex flex-wrap items-center justify-between gap-3 px-4 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <h2 className="text-base font-semibold text-ink-900">{SECTION_LABELS[section]}</h2>
        <span role="status" className={cn('inline-flex items-center gap-1.5 text-[12px]', dirty ? 'text-amber' : 'text-muted')}>
          {save.isPending ? <><Loader2 size={12} className="animate-spin" /> Saving...</> : dirty ? <><span className="h-1.5 w-1.5 rounded-full bg-amber" /> Unsaved changes</> : saved ? <><Check size={12} className="text-emerald" /> Saved</> : 'Not saved yet'}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <Can module={module} action="update" fallback={<span className="text-[12px] text-muted">View only</span>}>
          <Button size="sm" onClick={() => setReadOnly(!readOnly)}>{readOnly ? <Pencil size={14} /> : <Eye size={14} />}{readOnly ? 'Edit' : 'Preview'}</Button>
        </Can>
        <Tool icon={RotateCcw} label="Reload saved section" disabled={save.isPending} onClick={() => void reload()} />
        <Can module={module} action="update">
          <Tool icon={Upload} label="Import Excel sheet" disabled={readOnly || save.isPending} onClick={() => upload.current?.click()} />
        </Can>
        <Tool icon={Download} label="Export Excel" onClick={exportDocument} />
        <Can module={module} action="update">
          <Button size="sm" variant="primary" disabled={save.isPending || (!dirty && !!saved)} onClick={() => void saveDocument()}><Save size={14} /> Save</Button>
          <input ref={upload} type="file" accept=".xlsx,.xls" aria-label="Excel workbook" className="hidden" onChange={event => {
            const file = event.target.files?.[0]; if (file) void loadWorkbook(file); event.target.value = ''
          }} />
        </Can>
      </div>
    </div>
    {initial && dirty && <div className="px-4 pb-2 text-[12px] text-amber">Unsaved draft restored.</div>}
    {error && <div role="alert" className="border-y border-red-200 bg-red-50 px-4 py-2 text-[13px] text-crimson">{error}</div>}
    {draftWarning && <div role="alert" className="px-4 py-2 text-[12px] text-amber">{draftWarning}</div>}
    {!readOnly && <Can module={module} action="update"><Toolbar editor={editor} onInsert={() => setInserting(true)} onError={setError} /></Can>}
    <div className="synopsis-editor min-w-0 bg-white"><EditorContent editor={editor} /></div>
    <div className="flex flex-wrap gap-x-4 gap-y-1 border-t border-line px-4 py-2 text-[11px] text-muted">
      <span>{section === 'scope' ? 'Scope document' : 'RFP synopsis'}</span>
      <span>Revision {revision.current}</span>
      {saved?.updatedAt && <span>Saved {new Date(saved.updatedAt).toLocaleString('en-IN')}</span>}
      {saved?.updatedBy && <span>{saved.updatedBy}</span>}
    </div>
    <Dialog open={inserting} onClose={() => setInserting(false)} title="Insert table" footer={<>
      <Button size="sm" onClick={() => setInserting(false)}>Cancel</Button>
      <Button size="sm" variant="primary" onClick={() => {
        const columns = Array.from({ length: columnCount }, (_, index) => `Column ${index + 1}`)
        editor.chain().focus('end').insertContent([paragraphSpacer(), createTable(columns, rowCount, headerRow), paragraphSpacer()]).run()
        setInserting(false)
      }}><Table2 size={14} /> Insert</Button>
    </>}>
      <div className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <label className="text-[13px] text-muted">Rows<input aria-label="Table rows" type="number" min="1" max="100" value={rowCount} className={`${field} mt-1 w-full`} onChange={event => setRowCount(Math.min(100, Math.max(1, Number(event.target.value))))} /></label>
          <label className="text-[13px] text-muted">Columns<input aria-label="Table columns" type="number" min="1" max="20" value={columnCount}
            className={`${field} mt-1 w-full`} onChange={event => setColumnCount(Math.min(20, Math.max(1, Number(event.target.value))))} /></label>
        </div>
        <label className="inline-flex items-center gap-2 text-[13px]"><input type="checkbox" checked={headerRow} onChange={event => setHeaderRow(event.target.checked)} /> Header row</label>
      </div>
    </Dialog>
    <Dialog open={!!importBook} onClose={() => setImportBook(null)} title="Import Excel sheet" footer={<>
      <Button size="sm" onClick={() => setImportBook(null)}>Cancel</Button><Button size="sm" variant="primary" onClick={importDocument}><Upload size={14} /> Import</Button>
    </>}>
      <div className="space-y-4 text-[13px]">
        <p className="break-words font-medium">{importBook?.filename}</p>
        <label className="block text-muted">Worksheet<select aria-label="Worksheet" className={`${field} mt-1 w-full`} value={importSheet} onChange={event => setImportSheet(event.target.value)}>
          {importBook?.book.SheetNames.map(name => <option key={name} value={name}>{name}</option>)}
        </select></label>
        <fieldset className="flex flex-wrap gap-4"><legend className="mb-2 text-muted">Import into {SECTION_LABELS[section]}</legend>
          <label className="inline-flex items-center gap-2"><input type="radio" name="import-mode" checked={importMode === 'append'} onChange={() => setImportMode('append')} /> Append</label>
          <label className="inline-flex items-center gap-2"><input type="radio" name="import-mode" checked={importMode === 'replace'} onChange={() => setImportMode('replace')} /> Replace current section</label>
        </fieldset>
        {error && <p role="alert" className="text-crimson">{error}</p>}
      </div>
    </Dialog>
  </section>
}

function paragraphSpacer(): SynopsisNode { return { type: 'paragraph', content: [] } }
