import { useRef, useState } from 'react'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { Tooltip } from '@/components/ui/Tooltip'
import { useToast } from '@/components/ui/Toast'
import { useNodeMutations, useStates } from '@/lib/api'
import { NODE_TYPE_MAP, childTypesOf } from '@/lib/node-types'
import { useOrgRoots } from '@/lib/api'

function parseNames(raw: string): string[] {
  return raw
    .split(/\r?\n|,/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** Mirrors exactly what `onFile` below parses: row 1 is a header (skipped),
 *  then only the first column of every following row is read as a name. */
function downloadSampleCsv(childLabel: string) {
  const label = childLabel || 'Record'
  const rows = [
    ['Name'],
    [`${label} Example 1`],
    [`${label} Example 2`],
    [`${label} Example 3`],
  ]
  const csv = rows.map((r) => r.map(csvCell).join(',')).join('\r\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `import-sample-${label.toLowerCase().replace(/\s+/g, '-')}.csv`
  a.click()
  URL.revokeObjectURL(url)
}

export function ImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast()
  const { importChildren } = useNodeMutations()
  const { data: states = [] } = useStates()
  const [stateCode, setStateCode] = useState<number | null>(null)
  const { data: departments = [] } = useOrgRoots(stateCode ?? -1)
  const [parentId, setParentId] = useState('')
  const [raw, setRaw] = useState('')
  const [fileName, setFileName] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const rows = parseNames(raw)
  const parent = departments.find((d) => d.id === parentId)
  const childLabel = parent ? childTypesOf(parent.typeKey)[0]?.label ?? 'record' : 'record'

  function reset() {
    setStateCode(null); setParentId(''); setRaw(''); setFileName(null)
  }

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setFileName(f.name)
    f.text().then((text) => {
      const firstCol = text
        .split(/\r?\n/)
        .slice(1)
        .map((line) => line.split(',')[0]?.replace(/^"|"$/g, ''))
        .filter(Boolean)
      setRaw(firstCol.join('\n'))
    })
  }

  async function submit() {
    if (!parentId || rows.length === 0) return
    const count = await importChildren.mutateAsync({ parentId, names: rows })
    toast(`Imported ${count} ${childLabel.toLowerCase()}${count === 1 ? '' : 's'}`)
    reset()
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={() => { reset(); onClose() }}
      title="Import records"
      description="Bring in a batch of names as new nodes under an existing department. A full mapping-driven engine (external identifiers, upserts) lands in a later phase."
      size="lg"
      footer={
        <>
          <Button onClick={() => { reset(); onClose() }}>Cancel</Button>
          <Button variant="primary" onClick={submit} disabled={!parentId || rows.length === 0}>
            Import {rows.length > 0 ? `${rows.length} rows` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="State">
            <Select value={stateCode ?? ''} onChange={(e) => { setStateCode(e.target.value ? Number(e.target.value) : null); setParentId('') }}>
              <option value="">Select a state…</option>
              {states.map((s) => <option key={s.code} value={s.code}>{s.name}</option>)}
            </Select>
          </Field>
          <Field label="Department to import into">
            <Select value={parentId} onChange={(e) => setParentId(e.target.value)} disabled={!stateCode}>
              <option value="">{stateCode ? 'Select a department…' : 'Choose a state first'}</option>
              {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </Select>
          </Field>
        </div>

        <div className="flex items-center justify-between gap-2">
          <span className="text-[12px] font-medium text-ink-800">Not sure how to format your file?</span>
          <Tooltip label="Download a ready-to-fill CSV with sample rows in the exact format this importer expects" side="left">
            <button
              type="button"
              onClick={() => downloadSampleCsv(childLabel)}
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
              First column is used as the record name{parent ? ` — added as ${childLabel.toLowerCase()} under “${parent.name}”` : ''}.
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
            <li><span className="font-medium text-ink-700">Required:</span> a single “Name” column — the header row (row 1) is skipped.</li>
            <li><span className="font-medium text-ink-700">Optional:</span> none yet — any columns after the first are ignored.</li>
            <li>Column order: the name must be in column A.</li>
            <li>One {childLabel.toLowerCase()} per row; blank rows are skipped automatically.</li>
          </ul>
        </div>
      </div>
    </Dialog>
  )
}
