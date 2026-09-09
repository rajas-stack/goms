import { useState } from 'react'
import { Link } from 'react-router-dom'
import { AdminImportBanner } from './AdminImportBanner'
import { extractSheetsFromFile, buildSessionDomains, unresolvedRowsAreAllExcluded, type DetectedSheet } from './sessionUpload'
import {
  useValidateSession, useCommitSession, flattenSessionPreview,
  type ExcludedRow, type SessionCommitOutput, type SpreadsheetDomainKey,
} from './api'
import { TEMPLATE_COLUMNS } from './templates'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'

type SheetAssignment = { domain: SpreadsheetDomainKey; sheetTitle: string } | 'excluded'

const ALL_TEMPLATE_SHEETS = Object.entries(TEMPLATE_COLUMNS).flatMap(([domain, sheets]) =>
  sheets.map((s) => ({ domain: domain as SpreadsheetDomainKey, sheetTitle: s.sheet })),
)

function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

const ACTION_STYLES: Record<string, string> = {
  create: 'bg-emerald-100 text-emerald-600',
  update: 'bg-blue-100 text-blue-600',
  unchanged: 'bg-panel text-muted',
  'needs-review': 'bg-amber-100 text-amber-600',
  reject: 'bg-crimson-100 text-crimson',
  excluded: 'bg-panel text-muted/70 line-through',
}

export function SessionImportWizard() {
  const [sheets, setSheets] = useState<DetectedSheet[]>([])
  const [assignments, setAssignments] = useState<Map<string, SheetAssignment>>(new Map())
  const [excludedRows, setExcludedRows] = useState<ExcludedRow[]>([])
  const [excludeDraft, setExcludeDraft] = useState<Record<string, string>>({}) // rowKey -> in-progress reason text
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<SessionCommitOutput | null>(null)

  const validation = useValidateSession()
  const commit = useCommitSession()

  async function handleFiles(files: FileList) {
    const newSheets: DetectedSheet[] = []
    for (const file of Array.from(files)) {
      newSheets.push(...extractSheetsFromFile(file.name, await readAsArrayBuffer(file)))
    }
    setSheets((prev) => [...prev, ...newSheets])
    setAssignments((prev) => {
      const next = new Map(prev)
      for (const sheet of newSheets) {
        if (sheet.detection.kind === 'matched') next.set(sheet.id, { domain: sheet.detection.domain, sheetTitle: sheet.detection.sheetTitle })
      }
      return next
    })
  }

  const everySheetResolved = sheets.length > 0 && sheets.every((s) => assignments.has(s.id))

  // Always the ORIGINAL, untrimmed payload — used identically for both
  // validate and commit. Nothing ever removes a row from this; excluding a
  // row only ever adds to `excludedRows` state (see this task's design
  // note and Task 7's design note on why trimming happens server-side).
  function domainsPayload() {
    const nonExcluded = new Map(
      Array.from(assignments.entries()).filter((entry): entry is [string, { domain: SpreadsheetDomainKey; sheetTitle: string }] => entry[1] !== 'excluded'),
    )
    return buildSessionDomains(sheets, nonExcluded)
  }

  function runValidate() {
    validation.mutate({ domains: domainsPayload() })
  }

  const preview = validation.data
  const previewRows = preview ? flattenSessionPreview(preview.previews) : []
  const summary = preview?.summary
  const committable =
    !!summary && unresolvedRowsAreAllExcluded(previewRows, excludedRows) && (summary.toCreate + summary.toUpdate) > 0

  function rowKey(row: (typeof previewRows)[number]) {
    return `${row.domain}::${row.sheetKey ?? ''}::${row.rowNumber}`
  }

  // Adds to local exclusion state only — no re-validate, no trimming.
  // `committable` above recomputes reactively from the SAME preview this
  // row came from, and the Commit button's payload (below) still sends the
  // original, untrimmed `domainsPayload()` plus this same `excludedRows`.
  function confirmExclude(row: (typeof previewRows)[number]) {
    const reason = excludeDraft[rowKey(row)]?.trim()
    if (!reason) return
    setExcludedRows((prev) => [...prev, {
      domain: row.domain, rowNumber: row.rowNumber, sheet: row.sheet, sheetKey: row.sheetKey, businessKey: row.businessKey, reason,
    }])
  }

  return (
    <div className="h-full space-y-4 overflow-y-auto scrollbar-thin p-6">
      <AdminImportBanner />
      <div className="flex items-center justify-between gap-3">
        <h1 className="font-display text-lg font-bold text-ink-900">Import Session</h1>
        <Link
          to="/admin/data-import"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] font-medium text-muted transition-colors hover:bg-ink-900/[0.05] hover:text-ink"
        >
          <Icon name="ArrowLeft" size={14} /> Back to Data Import
        </Link>
      </div>

      {!result && (
        <div>
          <label htmlFor="session-import-files" className="mb-1.5 block text-[13px] font-medium text-ink-800">Upload files</label>
          <label
            htmlFor="session-import-files"
            className="flex w-full cursor-pointer items-center gap-3 rounded-lg border border-dashed border-line bg-panel/60 px-4 py-3 text-left transition-colors hover:border-ink-600"
          >
            <Icon name="FileSpreadsheet" className="text-muted" />
            <span className="min-w-0 flex-1">
              <span className="block text-sm font-medium text-ink-900">Choose files to upload</span>
              <span className="block text-xs text-muted">Multiple files — sheets are auto-detected per domain.</span>
            </span>
            <span className="code-chip">.xlsx / .xls / .csv</span>
          </label>
          <input
            id="session-import-files"
            aria-label="Upload files"
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={(e) => { if (e.target.files) void handleFiles(e.target.files) }}
            className="hidden"
          />
        </div>
      )}

      {sheets.length > 0 && !preview && (
        <div className="overflow-x-auto rounded-xl border border-line">
          <table className="w-full text-left text-[13px]">
            <thead className="border-b border-line bg-panel/60 text-muted">
              <tr>
                <th className="px-3 py-2 font-medium">File</th>
                <th className="px-3 py-2 font-medium">Sheet</th>
                <th className="px-3 py-2 font-medium">Rows</th>
                <th className="px-3 py-2 font-medium">Assignment</th>
              </tr>
            </thead>
            <tbody>
              {sheets.map((sheet) => {
                const assignment = assignments.get(sheet.id)
                return (
                  <tr key={sheet.id} className="border-b border-line last:border-0">
                    <td className="px-3 py-2 text-ink-900">{sheet.fileName}</td>
                    <td className="px-3 py-2 text-ink-900">{sheet.sheetTitle}</td>
                    <td className="px-3 py-2 text-muted">{sheet.rows.length}</td>
                    <td className="px-3 py-2">
                      {sheet.detection.kind === 'matched' ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-[12px] font-medium text-emerald-600">
                          <Icon name="Check" size={12} /> {sheet.detection.domain} — {sheet.detection.sheetTitle}
                        </span>
                      ) : (
                        <Select
                          value={assignment && assignment !== 'excluded' ? `${assignment.domain}::${assignment.sheetTitle}` : assignment === 'excluded' ? 'excluded' : ''}
                          onChange={(e) => {
                            const value = e.target.value
                            setAssignments((prev) => {
                              const next = new Map(prev)
                              if (value === 'excluded') next.set(sheet.id, 'excluded')
                              else {
                                const [domain, sheetTitle] = value.split('::')
                                next.set(sheet.id, { domain: domain as SpreadsheetDomainKey, sheetTitle })
                              }
                              return next
                            })
                          }}
                          className="h-8 text-[12px]"
                        >
                          <option value="" disabled>Which type of data is this sheet?</option>
                          {(sheet.detection.kind === 'ambiguous' ? sheet.detection.candidates : ALL_TEMPLATE_SHEETS).map((c) => (
                            <option key={`${c.domain}::${c.sheetTitle}`} value={`${c.domain}::${c.sheetTitle}`}>{c.domain} — {c.sheetTitle}</option>
                          ))}
                          <option value="excluded">Skip this sheet</option>
                        </Select>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {sheets.length > 0 && !preview && (
        <Button variant="primary" disabled={!everySheetResolved || validation.isPending} onClick={() => runValidate()}>
          {validation.isPending ? 'Validating…' : 'Validate Session'}
        </Button>
      )}

      {summary && !result && (
        <>
          <div className="flex flex-wrap gap-2 text-[12px]">
            <span className="rounded-full bg-emerald-100 px-2.5 py-1 font-medium text-emerald-600">{summary.toCreate} to create</span>
            <span className="rounded-full bg-blue-100 px-2.5 py-1 font-medium text-blue-600">{summary.toUpdate} to update</span>
            <span className="rounded-full bg-panel px-2.5 py-1 font-medium text-muted">{summary.unchanged} unchanged</span>
            <span className="rounded-full bg-amber-100 px-2.5 py-1 font-medium text-amber-600">{summary.needsReview} needs review</span>
            <span className="rounded-full bg-crimson-100 px-2.5 py-1 font-medium text-crimson">{summary.rejected} rejected</span>
          </div>

          <div className="overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-left text-[12px]">
              <thead className="border-b border-line bg-panel/60 text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">Domain</th><th className="px-3 py-2 font-medium">Sheet</th><th className="px-3 py-2 font-medium">Row</th>
                  <th className="px-3 py-2 font-medium">Key</th><th className="px-3 py-2 font-medium">Action</th><th className="px-3 py-2 font-medium">Details</th><th className="px-3 py-2 font-medium">Exclude</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => {
                  const key = rowKey(row)
                  const alreadyExcluded = excludedRows.some((r) => r.domain === row.domain && r.sheetKey === row.sheetKey && r.rowNumber === row.rowNumber)
                  return (
                    <tr key={key} className="border-b border-line last:border-0">
                      <td className="px-3 py-2 text-ink-900">{row.domain}</td>
                      <td className="px-3 py-2 text-muted">{row.sheet ?? ''}</td>
                      <td className="px-3 py-2 text-muted">{row.rowNumber}</td>
                      <td className="px-3 py-2 text-ink-900">{row.businessKey}</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${ACTION_STYLES[alreadyExcluded ? 'excluded' : row.action]}`}>
                          {alreadyExcluded ? 'excluded' : row.action}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {row.errors.length > 0 && <ul className="list-inside list-disc">{row.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                        {row.candidates && row.candidates.length > 0 && (
                          <p className="text-[11px] text-muted">
                            Did you mean: {row.candidates.map((c) => `${c.key} (${Math.round(c.score * 100)}%)`).join(', ')}?
                          </p>
                        )}
                        {row.diff?.map((d) => <div key={d.field}>{d.field}: {String(d.oldValue)} → {String(d.newValue)}</div>)}
                      </td>
                      <td className="px-3 py-2">
                        {(row.action === 'needs-review' || row.action === 'reject') && !alreadyExcluded && (
                          <div className="flex gap-1.5">
                            <input
                              aria-label={`Exclusion reason for row ${row.rowNumber}`}
                              value={excludeDraft[key] ?? ''}
                              onChange={(e) => setExcludeDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                              placeholder="Reason"
                              className="h-7 w-28 rounded-md border border-line bg-white px-2 text-[11px] text-ink placeholder:text-muted/70 transition-colors focus:border-ink-600 focus-visible:focus-ring"
                            />
                            <Button variant="danger" size="sm" className="h-7 px-2 text-[11px]" onClick={() => confirmExclude(row)}>
                              {row.candidates?.length ? 'None of these — exclude' : 'Exclude'}
                            </Button>
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          <Button variant="primary" disabled={!committable} onClick={() => setConfirming(true)}>
            Commit Session
          </Button>
        </>
      )}

      {confirming && summary && preview && !result && (
        <div role="dialog" aria-label="Confirm commit" className="rounded-lg border border-line bg-panel/60 p-4 text-[13px]">
          <p className="text-ink-900">
            This will create {summary.toCreate} and update {summary.toUpdate} records across {preview.domainOrder.length} domain(s). This cannot be undone from this screen.
          </p>
          {excludedRows.length > 0 && (
            <>
              <p className="mt-2 font-medium text-ink-900">{excludedRows.length} row(s) will be permanently excluded from this session:</p>
              <ul className="list-inside list-disc text-[12px] text-muted">
                {excludedRows.map((r) => <li key={`${r.domain}-${r.sheetKey}-${r.rowNumber}`}>{r.domain} row {r.rowNumber} ({r.businessKey}) — {r.reason}</li>)}
              </ul>
            </>
          )}
          <div className="mt-3 flex gap-2">
            <Button
              variant="primary"
              onClick={() =>
                // SAME domainsPayload() (untrimmed) and the SAME
                // preview.sessionCommitToken this validate call already
                // produced — session.commit does its own trimming
                // server-side (Task 7). Never pre-trim this payload; doing
                // so was the exact bug this design corrected (see Task 7's
                // design note on `runSessionCommit`).
                commit.mutate(
                  { domains: domainsPayload(), sessionCommitToken: preview.sessionCommitToken, excludedRows },
                  { onSuccess: (r) => { setResult(r); setConfirming(false) } },
                )
              }
            >
              Confirm Commit
            </Button>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
          </div>
        </div>
      )}

      {commit.isError && (
        <p role="alert" className="rounded-lg border border-crimson/30 bg-crimson-100 px-3.5 py-2.5 text-[13px] text-crimson">
          Nothing was written — the session was rolled back. {(commit.error as Error).message}
        </p>
      )}

      {result && (
        <div className="flex items-start gap-2.5 rounded-lg border border-emerald/30 bg-emerald-100 px-4 py-3 text-[13px] text-emerald-600">
          <Icon name="Check" size={16} className="mt-0.5 shrink-0" />
          <div>
            <h2 className="font-medium">Session complete</h2>
            <p>{result.summary.toCreate} created, {result.summary.toUpdate} updated, {result.summary.unchanged} unchanged, {excludedRows.length} explicitly excluded.</p>
          </div>
        </div>
      )}
    </div>
  )
}
