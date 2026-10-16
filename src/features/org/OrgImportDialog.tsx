import { useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { downloadCsv, toCsv } from '@/lib/csv'
import { levelLabel, type OrgPerson } from '@/data/org-structure'
import { ORG_IMPORT_HEADERS, orgImportTemplateRows, planOrgImport, readOrgImportSheet, runOrgImport, type OrgImportResult, type OrgImportRow } from './orgImport'

type CreateInput = Parameters<typeof runOrgImport>[2]

/** Bulk-add people to the company org from a CSV/Excel sheet: pick a file, review every row, then import the valid ones. */
export function OrgImportDialog({ people, departmentOptions, emailEditable, canEdit, create, onClose }: {
  people: readonly OrgPerson[]
  departmentOptions: readonly string[]
  emailEditable: boolean
  canEdit: boolean
  create: CreateInput
  onClose: () => void
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [fileName, setFileName] = useState('')
  const [rows, setRows] = useState<OrgImportRow[] | null>(null)
  const [readError, setReadError] = useState<string | null>(null)
  const [progress, setProgress] = useState<[number, number] | null>(null)
  const [results, setResults] = useState<OrgImportResult[] | null>(null)

  const plan = useMemo(() => (rows ? planOrgImport(rows, people, departmentOptions, { emailEditable }) : []), [rows, people, departmentOptions, emailEditable])
  const count = (status: 'ok' | 'skip' | 'error') => plan.filter((i) => i.status === status).length
  const importing = progress !== null && results === null

  const pick = async (file: File | undefined) => {
    if (!file) return
    setReadError(null); setResults(null); setRows(null); setFileName(file.name)
    try {
      const isCsv = /\.csv$/i.test(file.name)
      const parsed = readOrgImportSheet(isCsv ? await file.text() : await file.arrayBuffer())
      if (!parsed.length) setReadError('No employee rows found. Use the template: a header row with Name, Designation, Level, Departments, Reports to, Email.')
      else setRows(parsed)
    } catch { setReadError('That file could not be read. Upload a .csv, .xlsx or .xls file.') }
  }

  const start = async () => {
    setProgress([0, count('ok')])
    const done = await runOrgImport(plan, people, create, (d, t) => setProgress([d, t]))
    setResults(done); setProgress(null)
  }

  const failed = results?.filter((r) => !r.ok) ?? []
  return (
    <Dialog
      open onClose={importing ? () => undefined : onClose} title="Import employees" size="xl"
      description="Add many people at once from a CSV or Excel sheet. People already in the org are skipped."
      footer={<>
        <Button variant="secondary" disabled={importing} onClick={onClose}>{results ? 'Close' : 'Cancel'}</Button>
        {!results && <Button variant="primary" disabled={!canEdit || importing || count('ok') === 0} onClick={() => void start()}>
          {importing ? `Importing ${progress?.[0]}/${progress?.[1]}…` : `Import ${count('ok')} ${count('ok') === 1 ? 'person' : 'people'}`}
        </Button>}
      </>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input ref={fileRef} type="file" accept=".csv,.xlsx,.xls" aria-label="Employee file" className="sr-only" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = '' }} />
        <Button variant="secondary" disabled={importing} onClick={() => fileRef.current?.click()}><Icon name="Upload" size={14} /> Choose file</Button>
        <Button variant="ghost" onClick={() => void downloadCsv('employees-import-template.csv', toCsv(orgImportTemplateRows()))}><Icon name="Download" size={14} /> Download template</Button>
        <span className="text-[12px] text-muted">{fileName || 'No file chosen'}</span>
      </div>
      <p className="mt-2 text-[12px] text-muted">
        Columns: {ORG_IMPORT_HEADERS.join(', ')}. Level is L0–L7. Departments must already exist (separate several with “;”). Reports to is the manager's full name, in the org or in this file.
        {!emailEditable && ' Emails are ignored: only System Admins can set them.'}
      </p>
      {readError && <p role="alert" className="mt-3 rounded-lg bg-crimson-100 px-3 py-1.5 text-[12px] text-crimson">{readError}</p>}

      {rows && !results && <>
        <p className="mt-3 text-[13px] text-ink-800" aria-live="polite">
          <strong>{count('ok')}</strong> ready · <strong>{count('skip')}</strong> skipped · <strong className={count('error') ? 'text-crimson' : undefined}>{count('error')}</strong> with problems
          {count('error') > 0 && ' (rows with problems are not imported; fix the sheet and choose it again)'}
        </p>
        <div className="mt-2 max-h-80 overflow-auto rounded-lg border border-line">
          <table className="w-full border-separate border-spacing-0 text-[12px]">
            <thead className="sticky top-0 bg-grid-head text-left text-[11px] font-semibold uppercase tracking-wide text-ink-600">
              <tr>{['Row', 'Name', 'Level', 'Reports to', 'Departments', 'Result'].map((h) => <th key={h} className="border-b border-line px-2 py-1.5">{h}</th>)}</tr>
            </thead>
            <tbody>
              {plan.map((i) => (
                <tr key={i.line}>
                  <td className="border-b border-line/70 px-2 py-1 text-muted">{i.line}</td>
                  <td className="border-b border-line/70 px-2 py-1 font-medium text-ink-900">{i.name || '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1">{Number.isFinite(i.level) ? levelLabel(i.level) : '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1">{i.managerName || '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1">{i.departments.join(', ') || '—'}</td>
                  <td className="border-b border-line/70 px-2 py-1">
                    {i.status === 'ok' && <span className="text-emerald-700">Ready{i.notes.length ? ` · ${i.notes.join(' ')}` : ''}</span>}
                    {i.status === 'skip' && <span className="text-muted">Skipped · {i.notes.join(' ')}</span>}
                    {i.status === 'error' && <span className="text-crimson">{i.problems.join(' ')}</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>}

      {results && (
        <div className="mt-3" role="status">
          <p className="text-[13px] text-ink-900"><strong>{results.length - failed.length}</strong> added{failed.length ? <>, <strong className="text-crimson">{failed.length}</strong> not added</> : '.'}</p>
          {failed.length > 0 && (
            <ul className="mt-2 max-h-48 list-disc space-y-0.5 overflow-auto pl-5 text-[12px] text-crimson">
              {failed.map((r) => <li key={r.line}>Row {r.line} · {r.name}: {r.message}</li>)}
            </ul>
          )}
        </div>
      )}
    </Dialog>
  )
}
