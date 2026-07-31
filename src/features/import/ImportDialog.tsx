import { useEffect, useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Tabs } from '@/components/ui/Tabs'
import { Tooltip } from '@/components/ui/Tooltip'
import { DraftNotice } from '@/components/ui/DraftNotice'
import { useToast } from '@/components/ui/Toast'
import { useEmployeeMutations, useNodeMutations, useOrgRoots, usePostingNodes, useStates } from '@/lib/api'
import { useFormDraft } from '@/lib/useFormDraft'
import { downloadCsv, toCsv } from '@/lib/csv'
import { childTypesOf } from '@/lib/node-types'
import type { ImportChildRow, ImportEmployeeRow } from '@/data/repository'

type Mode = 'nodes' | 'employees'

const MODES: { value: Mode; label: string }[] = [
  { value: 'nodes', label: 'Departments' },
  { value: 'employees', label: 'People' },
]

const EMPTY_IMPORT = {
  mode: 'nodes' as Mode, stateCode: null as number | null, parentId: '', raw: '', fileName: null as string | null,
}

/** Columns each mode reads, in order — drives the sample CSV, the format
 *  notes, and `parseRows` below, so all three can't drift apart. */
const SCHEMA: Record<Mode, { key: string; label: string; required: boolean; hint?: string }[]> = {
  nodes: [
    { key: 'name', label: 'Name', required: true },
    { key: 'type', label: 'Type', required: false, hint: 'blank falls back to the parent’s default child type' },
  ],
  employees: [
    { key: 'name', label: 'Name', required: true },
    { key: 'designation', label: 'Designation', required: true },
    { key: 'email', label: 'Email', required: false },
    { key: 'phone', label: 'Phone', required: false },
    { key: 'connected', label: 'Connected', required: false, hint: 'yes/no — defaults to yes' },
  ],
}

/** Splits one CSV line, honouring double-quoted fields (and "" escapes) so a
 *  quoted address or designation containing a comma stays one column. */
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < line.length; i += 1) {
    const c = line[i]
    if (quoted) {
      if (c === '"') {
        if (line[i + 1] === '"') { field += '"'; i += 1 }
        else quoted = false
      } else field += c
    } else if (c === '"') quoted = true
    else if (c === ',') { out.push(field); field = '' }
    else field += c
  }
  out.push(field)
  return out.map((f) => f.trim())
}

/** The single source of truth for what a pasted/uploaded batch means: the raw
 *  text is kept verbatim (so a restored draft round-trips) and re-parsed into
 *  typed rows on every render. Row 1 is never treated as a header here — the
 *  file reader strips it before this sees the text. */
function parseRows(raw: string, mode: Mode): (ImportChildRow | ImportEmployeeRow)[] {
  const lines = raw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  if (mode === 'nodes') {
    return lines.flatMap((line) => {
      const [name, type] = splitCsvLine(line)
      return name ? [{ name, ...(type ? { type } : {}) } satisfies ImportChildRow] : []
    })
  }
  return lines.flatMap((line) => {
    const [name, designation, email, phone, connected] = splitCsvLine(line)
    if (!name || !designation) return []
    const row: ImportEmployeeRow = { name, designation, email, phone }
    if (connected) row.connected = !/^(no|false|0|n)$/i.test(connected)
    return [row]
  })
}

/** Mirrors ExportDialog's department column set, purely for the sample file
 *  a user fills in and re-uploads — `parseRows` below still only reads
 *  Name/Type for this mode, so the extra columns are informational only. */
const DEPARTMENT_SAMPLE_HEADER = [
  'State', 'Department', 'Short name', 'Code', 'Website', 'Contact', 'Email', 'Office address', 'Description',
]

function downloadSampleCsv(mode: Mode, childLabel: string) {
  if (mode === 'nodes') {
    const example = (n: number) => [
      'Rajasthan', `Department Example ${n}`, `DE${n}`, `DEPT-00${n}`,
      'https://example.gov.in', '011-23456789', 'contact@example.gov.in', 'Sample Office Address', 'Sample department description',
    ]
    const rows = [DEPARTMENT_SAMPLE_HEADER, example(1), example(2), example(3)]
    downloadCsv(`import-sample-${mode}.csv`, toCsv(rows))
    return
  }
  const cols = SCHEMA[mode]
  const example = (n: number) => cols.map((c) => {
    if (c.key === 'name') return `Example Person ${n}`
    if (c.key === 'designation') return 'Deputy Director'
    if (c.key === 'email') return `person${n}@example.gov.in`
    if (c.key === 'phone') return `98765 4321${n}`
    if (c.key === 'connected') return 'yes'
    return ''
  })
  const rows = [cols.map((c) => c.label), example(1), example(2), example(3)]
  downloadCsv(`import-sample-${mode}.csv`, toCsv(rows))
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { importChildren } = useNodeMutations()
  const { importEmployees } = useEmployeeMutations()
  const { data: states = [] } = useStates()
  const [mode, setMode] = useState<Mode>('nodes')
  const [stateCode, setStateCode] = useState<number | null>(null)
  // Org records land under a department; people are posted at any posting-type
  // node (department/branch/division/office/unit), so each mode picks its
  // target from a different list.
  const { data: departments = [] } = useOrgRoots(stateCode ?? -1)
  const { data: postings = [] } = usePostingNodes(stateCode)
  const targets = mode === 'nodes' ? departments : postings
  const [parentId, setParentId] = useState('')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  // A single global draft slot — unlike the record-editing dialogs, an import
  // in progress isn't "for" any particular record, so there's nothing to key
  // it by except "the Import dialog". A pasted or uploaded batch can be
  // sizeable, so losing it to a reload would be the most painful case here.
  const draftForm = { mode, stateCode, parentId, raw, fileName }
  const draft = useFormDraft('import', draftForm, open, () => {
    setMode(EMPTY_IMPORT.mode); setStateCode(EMPTY_IMPORT.stateCode); setParentId(EMPTY_IMPORT.parentId)
    setRaw(EMPTY_IMPORT.raw); setFileName(EMPTY_IMPORT.fileName)
  })

  useEffect(() => {
    if (!open) return
    const restored = draft.take(EMPTY_IMPORT)
    if (restored) {
      setMode(restored.mode); setStateCode(restored.stateCode); setParentId(restored.parentId)
      setRaw(restored.raw); setFileName(restored.fileName)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const rows = parseRows(raw, mode)
  const parent = targets.find((d) => d.id === parentId)
  const childLabel = mode === 'employees'
    ? 'person'
    : parent ? childTypesOf(parent.typeKey)[0]?.label ?? 'record' : 'record'
  const isPending = importChildren.isPending || importEmployees.isPending

  function reset() {
    setStateCode(null); setParentId(''); setRaw(''); setFileName(null)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    // Row 1 is dropped as the header; the rest is kept verbatim so `parseRows`
    // stays the only thing that decides what the columns mean.
    f.text().then((text) => setRaw(text.split(/\r?\n/).slice(1).join('\n')))
  }

  async function submit() {
    if (!parentId || rows.length === 0) return
    const count = mode === 'nodes'
      ? await importChildren.mutateAsync({ parentId, rows: rows as ImportChildRow[] })
      : await importEmployees.mutateAsync({ orgNodeId: parentId, rows: rows as ImportEmployeeRow[] })
    const noun = mode === 'nodes' ? childLabel.toLowerCase() : 'person'
    const plural = mode === 'nodes' ? `${noun}s` : 'people'
    toast(`Imported ${count} ${count === 1 ? noun : plural}`)
    reset()
    draft.clear()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Import records"
      description="Bring in a batch of org records or people from a CSV. A full mapping-driven engine (external identifiers, upserts) lands in a later phase."
      size="lg"
      footer={
        <>
          <Button onClick={() => { reset(); onClose() }} disabled={isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!parentId || rows.length === 0 || isPending}>
            {isPending ? 'Importing…' : `Import ${rows.length > 0 ? `${rows.length} rows` : ''}`}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {draft.restored && <DraftNotice onDiscard={draft.discard} />}

        <Tabs
          tabs={MODES}
          value={mode}
          onChange={(next) => {
            // The column meanings differ per mode, so a batch parsed for one
            // schema is meaningless under the other — cleared rather than
            // silently reinterpreted.
            setMode(next); setParentId(''); setRaw(''); setFileName(null)
          }}
        />

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="State">
            <Select value={stateCode ?? ''} onChange={(e) => { setStateCode(e.target.value ? Number(e.target.value) : null); setParentId('') }}>
              <option value="">Select a state…</option>
              {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label={mode === 'nodes' ? 'Department to import into' : 'Posting to import into'}>
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={stateCode === null}>
              <option value="">
                {stateCode !== null
                  ? (mode === 'nodes' ? 'Select a department…' : 'Select a posting…')
                  : 'Choose a state first'}
              </option>
              {targets.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-ink-800">Not sure how to format your file?</span>
          <Tooltip label="Download a ready-to-fill CSV with sample rows in the exact format this importer expects" side="left">
            <button
              type="button"
              onClick={() => downloadSampleCsv(mode, childLabel)}
              className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[12px] font-medium text-teal-600 transition-colors hover:bg-teal-100"
            >
              <Icon name="Download" size={13} /> Download sample file
            </button>
          </Tooltip>
        </div>

        <button
          onClick={() => fileRef.current?.click()}
          className="flex w-full items-center gap-3 rounded-lg border border-dashed border-line bg-panel/60 px-4 py-3 text-left transition-colors hover:border-ink-600"
        >
          <Icon name="FileSpreadsheet" className="text-muted" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-medium text-ink-900">{fileName ?? 'Upload a CSV file'}</span>
            <span className="block text-xs text-muted">
              {SCHEMA[mode].map((c) => c.label).join(', ')}
              {parent ? ` — added under “${parent.name}”` : ''}.
            </span>
          </span>
          <span className="code-chip">.csv</span>
        </button>
        <input ref={fileRef} type="file" accept=".csv,text/csv" onChange={onFile} className="hidden" />

        {rows.length > 0 && (
          <p className="flex items-center gap-1.5 text-[12px] text-teal-600">
            <Icon name="Check" size={13} /> {rows.length} rows ready to import
          </p>
        )}

        <div className="rounded-lg border border-line bg-panel/60 px-3 py-2.5 text-[11px] leading-relaxed text-muted">
          <p className="mb-1 font-medium text-ink-800">File format notes</p>
          <ul className="list-disc space-y-0.5 pl-4">
            <li>
              <span className="font-medium text-ink-700">Required:</span>{' '}
              {SCHEMA[mode].filter((c) => c.required).map((c) => c.label).join(', ')} — the header row (row 1) is skipped.
            </li>
            <li>
              <span className="font-medium text-ink-700">Optional:</span>{' '}
              {SCHEMA[mode].filter((c) => !c.required).map((c) => c.hint ? `${c.label} (${c.hint})` : c.label).join(', ') || 'none'}.
            </li>
            <li>Column order: {SCHEMA[mode].map((c, i) => `${String.fromCharCode(65 + i)} = ${c.label}`).join(', ')}.</li>
            <li>
              One {mode === 'nodes' ? childLabel.toLowerCase() : 'person'} per row; blank rows are skipped, and rows missing a
              required column are ignored rather than half-imported.
            </li>
            <li>Wrap a value in double quotes if it contains a comma.</li>
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
