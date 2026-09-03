import { useState } from 'react'
import { AdminImportBanner } from './AdminImportBanner'
import { ImportNavLink } from './ImportNavLink'
import { extractSheetsFromFile, buildSessionDomains, unresolvedRowsAreAllExcluded, type DetectedSheet } from './sessionUpload'
import {
  useValidateSession, useCommitSession, flattenSessionPreview,
  type ExcludedRow, type SessionCommitOutput, type SpreadsheetDomainKey,
} from './api'
import { TEMPLATE_COLUMNS } from './templates'

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
  create: 'bg-emerald-50 text-emerald-900',
  update: 'bg-sky-50 text-sky-900',
  unchanged: 'bg-slate-50 text-slate-600',
  'needs-review': 'bg-amber-50 text-amber-900',
  reject: 'bg-rose-50 text-rose-900',
  excluded: 'bg-slate-100 text-slate-400 line-through',
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
    <div className="space-y-4 p-6">
      <AdminImportBanner />
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Import Session</h1>
        <ImportNavLink to="dashboard" className="text-sky-700 underline">Back to Data Import</ImportNavLink>
      </div>

      {!result && (
        <div>
          <label htmlFor="session-import-files" className="block text-sm font-medium">Upload files</label>
          <input
            id="session-import-files"
            aria-label="Upload files"
            type="file"
            accept=".xlsx,.xls,.csv"
            multiple
            onChange={(e) => { if (e.target.files) void handleFiles(e.target.files) }}
          />
        </div>
      )}

      {sheets.length > 0 && !preview && (
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr className="border-b"><th className="py-1">File</th><th className="py-1">Sheet</th><th className="py-1">Rows</th><th className="py-1">Assignment</th></tr>
          </thead>
          <tbody>
            {sheets.map((sheet) => {
              const assignment = assignments.get(sheet.id)
              return (
                <tr key={sheet.id} className="border-b">
                  <td className="py-1">{sheet.fileName}</td>
                  <td className="py-1">{sheet.sheetTitle}</td>
                  <td className="py-1">{sheet.rows.length}</td>
                  <td className="py-1">
                    {sheet.detection.kind === 'matched' ? (
                      <span>{sheet.detection.domain} — {sheet.detection.sheetTitle}</span>
                    ) : (
                      <select
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
                      >
                        <option value="" disabled>Which type of data is this sheet?</option>
                        {(sheet.detection.kind === 'ambiguous' ? sheet.detection.candidates : ALL_TEMPLATE_SHEETS).map((c) => (
                          <option key={`${c.domain}::${c.sheetTitle}`} value={`${c.domain}::${c.sheetTitle}`}>{c.domain} — {c.sheetTitle}</option>
                        ))}
                        <option value="excluded">Skip this sheet</option>
                      </select>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}

      {sheets.length > 0 && !preview && (
        <button
          type="button"
          disabled={!everySheetResolved || validation.isPending}
          onClick={() => runValidate()}
          className="rounded bg-sky-700 px-3 py-1 text-white disabled:bg-slate-300"
        >
          Validate Session
        </button>
      )}

      {summary && !result && (
        <>
          <div className="flex gap-4 text-sm">
            <span>{summary.toCreate} to create</span>
            <span>{summary.toUpdate} to update</span>
            <span>{summary.unchanged} unchanged</span>
            <span>{summary.needsReview} needs review</span>
            <span>{summary.rejected} rejected</span>
          </div>

          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b">
                <th className="py-1">Domain</th><th className="py-1">Sheet</th><th className="py-1">Row</th>
                <th className="py-1">Key</th><th className="py-1">Action</th><th className="py-1">Details</th><th className="py-1">Exclude</th>
              </tr>
            </thead>
            <tbody>
              {previewRows.map((row) => {
                const key = rowKey(row)
                const alreadyExcluded = excludedRows.some((r) => r.domain === row.domain && r.sheetKey === row.sheetKey && r.rowNumber === row.rowNumber)
                return (
                  <tr key={key} className={`border-b ${ACTION_STYLES[alreadyExcluded ? 'excluded' : row.action]}`}>
                    <td className="py-1">{row.domain}</td>
                    <td className="py-1">{row.sheet ?? ''}</td>
                    <td className="py-1">{row.rowNumber}</td>
                    <td className="py-1">{row.businessKey}</td>
                    <td className="py-1">{alreadyExcluded ? 'excluded' : row.action}</td>
                    <td className="py-1">
                      {row.errors.length > 0 && <ul className="list-inside list-disc">{row.errors.map((e) => <li key={e}>{e}</li>)}</ul>}
                      {row.candidates && row.candidates.length > 0 && (
                        <p className="text-xs text-slate-500">
                          Did you mean: {row.candidates.map((c) => `${c.key} (${Math.round(c.score * 100)}%)`).join(', ')}?
                        </p>
                      )}
                      {row.diff?.map((d) => <div key={d.field}>{d.field}: {String(d.oldValue)} → {String(d.newValue)}</div>)}
                    </td>
                    <td className="py-1">
                      {(row.action === 'needs-review' || row.action === 'reject') && !alreadyExcluded && (
                        <div className="flex gap-1">
                          <input
                            aria-label={`Exclusion reason for row ${row.rowNumber}`}
                            value={excludeDraft[key] ?? ''}
                            onChange={(e) => setExcludeDraft((prev) => ({ ...prev, [key]: e.target.value }))}
                            placeholder="Reason"
                            className="border px-1 text-xs"
                          />
                          <button type="button" onClick={() => confirmExclude(row)} className="text-xs text-rose-700 underline">
                            {row.candidates?.length ? 'None of these — exclude' : 'Exclude'}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>

          <button
            type="button"
            disabled={!committable}
            onClick={() => setConfirming(true)}
            className="rounded bg-sky-700 px-3 py-1 text-white disabled:bg-slate-300"
          >
            Commit Session
          </button>
        </>
      )}

      {confirming && summary && preview && !result && (
        <div role="dialog" aria-label="Confirm commit" className="rounded border border-slate-400 p-4">
          <p>This will create {summary.toCreate} and update {summary.toUpdate} records across {preview.domainOrder.length} domain(s). This cannot be undone from this screen.</p>
          {excludedRows.length > 0 && (
            <>
              <p className="mt-2 font-semibold">{excludedRows.length} row(s) will be permanently excluded from this session:</p>
              <ul className="list-inside list-disc text-sm">
                {excludedRows.map((r) => <li key={`${r.domain}-${r.sheetKey}-${r.rowNumber}`}>{r.domain} row {r.rowNumber} ({r.businessKey}) — {r.reason}</li>)}
              </ul>
            </>
          )}
          <div className="mt-3 flex gap-3">
            <button
              type="button"
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
              className="rounded bg-sky-700 px-3 py-1 text-white"
            >
              Confirm Commit
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded border px-3 py-1">Cancel</button>
          </div>
        </div>
      )}

      {commit.isError && <p role="alert" className="text-rose-700">Nothing was written — the session was rolled back. {(commit.error as Error).message}</p>}

      {result && (
        <div className="rounded border border-emerald-500 bg-emerald-50 p-4">
          <h2 className="font-semibold">Session complete</h2>
          <p>{result.summary.toCreate} created, {result.summary.toUpdate} updated, {result.summary.unchanged} unchanged, {excludedRows.length} explicitly excluded.</p>
        </div>
      )}
    </div>
  )
}
