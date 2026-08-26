import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { downloadFile } from '@/lib/file-export'
import { AdminImportBanner } from './AdminImportBanner'
import {
  flattenPreview, useCommitImport, useValidateImport,
  type ImportRowResult, type ImportRows, type ImportSummary, type SpreadsheetDomainKey,
} from './api'
import { SPREADSHEET_DOMAIN_KEYS, TEMPLATE_COLUMNS, downloadTemplate, parseWorkbook } from './templates'

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value
}

/** A deliberate frontend copy of apps/api/src/import/errorReport.ts's
 *  formatter — the Errors column is always quoted, since it's a
 *  semicolon-joined aggregate of arbitrary validation text that could itself
 *  contain a comma. There is no shared import across the apps/api/frontend
 *  project boundary anywhere in this codebase, so this matches precedent. */
export function buildErrorReportCsv(rows: ImportRowResult[]): string {
  const lines = ['Row,Business Key,Errors']
  for (const row of rows) {
    if (row.action !== 'reject') continue
    lines.push([String(row.rowNumber), csvField(row.businessKey), `"${row.errors.join('; ').replace(/"/g, '""')}"`].join(','))
  }
  return lines.join('\n') + '\n'
}

// FileReader rather than `File.arrayBuffer()` — the latter is missing from
// jsdom's Blob implementation, so every parse would land in the catch branch
// under test while working fine in a real browser.
function readAsArrayBuffer(file: File): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as ArrayBuffer)
    reader.onerror = () => reject(reader.error)
    reader.readAsArrayBuffer(file)
  })
}

const ACTION_STYLES: Record<ImportRowResult['action'], string> = {
  create: 'bg-emerald-50 text-emerald-900',
  update: 'bg-sky-50 text-sky-900',
  unchanged: 'bg-slate-50 text-slate-600',
  reject: 'bg-rose-50 text-rose-900',
}

function RowDetail({ row }: { row: ImportRowResult }) {
  if (row.action === 'reject') {
    return (
      <ul className="list-inside list-disc">
        {row.errors.map((e) => (
          <li key={e}>{e}</li>
        ))}
      </ul>
    )
  }
  if (row.action === 'update' && row.diff) {
    return (
      <ul className="list-inside list-disc">
        {row.diff.map((d) => (
          <li key={d.field}>
            {d.field}: {String(d.oldValue)} → {String(d.newValue)}
          </li>
        ))}
      </ul>
    )
  }
  return null
}

export function ImportWizard() {
  const { domain: domainParam } = useParams<{ domain: string }>()
  const domain = SPREADSHEET_DOMAIN_KEYS.find((d) => d === domainParam) as SpreadsheetDomainKey | undefined

  const [parseError, setParseError] = useState<string | null>(null)
  const [rows, setRows] = useState<ImportRows | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [result, setResult] = useState<ImportSummary | null>(null)

  const validation = useValidateImport()
  const commit = useCommitImport()

  if (!domain) {
    return (
      <div className="space-y-4 p-6">
        <p>Unknown import domain "{domainParam}".</p>
        <Link to="/admin/data-import" className="text-sky-700 underline">
          Back to Data Import
        </Link>
      </div>
    )
  }

  async function handleFile(file: File) {
    setParseError(null)
    setResult(null)
    setConfirming(false)
    let parsed: ImportRows
    try {
      parsed = parseWorkbook(domain!, await readAsArrayBuffer(file))
    } catch {
      setParseError('Could not read this file. Please upload the downloaded .xlsx template, filled in.')
      return
    }
    setRows(parsed)
    validation.mutate({ domain: domain!, rows: parsed })
  }

  const preview = validation.data
  const previewRows = preview ? flattenPreview(preview.preview) : []
  const summary = preview?.summary
  const committable = (summary?.toCreate ?? 0) + (summary?.toUpdate ?? 0) > 0

  return (
    <div className="space-y-4 p-6">
      <AdminImportBanner />
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Import — {domain}</h1>
        <Link to="/admin/data-import" className="text-sky-700 underline">
          Back to Data Import
        </Link>
      </div>

      <p className="text-sm text-slate-600">
        Expected sheets: {TEMPLATE_COLUMNS[domain].map((s) => s.sheet).join(', ')}.{' '}
        <button type="button" onClick={() => downloadTemplate(domain)} className="text-sky-700 underline">
          Download Template
        </button>
      </p>

      <div>
        <label htmlFor="admin-import-file" className="block text-sm font-medium">
          Upload file
        </label>
        <input
          id="admin-import-file"
          type="file"
          accept=".xlsx,.xls,.csv"
          onChange={(e) => {
            const file = e.target.files?.[0]
            if (file) void handleFile(file)
          }}
        />
      </div>

      {parseError && <p role="alert" className="text-rose-700">{parseError}</p>}
      {validation.isPending && <p>Validating…</p>}
      {validation.isError && (
        <p role="alert" className="text-rose-700">
          Validation failed: {(validation.error as Error).message}
        </p>
      )}

      {summary && !result && (
        <>
          <div className="flex gap-4 text-sm">
            <span>{summary.toCreate} to create</span>
            <span>{summary.toUpdate} to update</span>
            <span>{summary.unchanged} unchanged</span>
            <span>{summary.rejected} rejected</span>
          </div>

          <div className="flex gap-3">
            <button
              type="button"
              disabled={!committable}
              onClick={() => setConfirming(true)}
              className="rounded bg-sky-700 px-3 py-1 text-white disabled:bg-slate-300"
            >
              Commit Import
            </button>
            {summary.rejected > 0 && (
              <button
                type="button"
                onClick={() => void downloadFile(`goms-import-errors-${domain}.csv`, buildErrorReportCsv(previewRows), 'text/csv')}
                className="rounded border px-3 py-1"
              >
                Download Error Report
              </button>
            )}
          </div>

          {previewRows.length > 0 && (
            <table className="w-full border-collapse text-left text-sm">
              <thead>
                <tr className="border-b">
                  <th className="py-1">Row</th>
                  <th className="py-1">Sheet</th>
                  <th className="py-1">Business Key</th>
                  <th className="py-1">Action</th>
                  <th className="py-1">Details</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={`${row.sheet ?? ''}-${row.rowNumber}`} className={`border-b ${ACTION_STYLES[row.action]}`}>
                    <td className="py-1">{row.rowNumber}</td>
                    <td className="py-1">{row.sheet ?? ''}</td>
                    <td className="py-1">{row.businessKey}</td>
                    <td className="py-1">{row.action}</td>
                    <td className="py-1">
                      <RowDetail row={row} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}

      {confirming && summary && !result && (
        <div role="dialog" aria-label="Confirm commit" className="rounded border border-slate-400 p-4">
          <p>
            This will create {summary.toCreate} and update {summary.toUpdate} records. Rejected rows are never written.
            This cannot be undone from this screen.
          </p>
          <div className="mt-3 flex gap-3">
            <button
              type="button"
              onClick={() =>
                commit.mutate(
                  { domain, commitToken: preview!.commitToken, rows: rows! },
                  { onSuccess: (r) => { setResult(r.summary); setConfirming(false) } },
                )
              }
              className="rounded bg-sky-700 px-3 py-1 text-white"
            >
              Confirm Commit
            </button>
            <button type="button" onClick={() => setConfirming(false)} className="rounded border px-3 py-1">
              Cancel
            </button>
          </div>
        </div>
      )}

      {commit.isError && (
        <p role="alert" className="text-rose-700">
          Nothing was written — the import was rolled back. {(commit.error as Error).message}
        </p>
      )}

      {result && (
        <div className="rounded border border-emerald-500 bg-emerald-50 p-4">
          <h2 className="font-semibold">Import complete</h2>
          <p>
            {result.toCreate} created, {result.toUpdate} updated, {result.unchanged} unchanged, {result.rejected} rejected
            (not written).
          </p>
        </div>
      )}
    </div>
  )
}
