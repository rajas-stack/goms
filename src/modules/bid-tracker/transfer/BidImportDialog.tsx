import { useMemo, useRef, useState } from 'react'
import type { BidImportPreview, BidImportTable, BidTransferContext } from '@goms/domain'
import { repository } from '@/data/repository'
import { useBidTransferMutation } from './api'
import { downloadBinaryFile } from '@/lib/file-export'
import { Dialog } from '@/components/ui/Dialog'
import { Button } from '@/components/ui/Button'
import { bidTemplate, failedBidReport, MAX_BID_FILE_BYTES, parseBidWorkbook, WORKBOOK_MIME } from './workbooks'

export function BidImportDialog({ open, onClose, customFields = [] }: { open: boolean; onClose: () => void; customFields?: BidTransferContext['customFields'] }) {
  const { importBids } = useBidTransferMutation()
  const [table, setTable] = useState<BidImportTable | null>(null)
  const [preview, setPreview] = useState<BidImportPreview | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [fileName, setFileName] = useState('')
  const [reviewed, setReviewed] = useState(false)
  const [success, setSuccess] = useState('')
  const generation = useRef(0)
  const committing = useRef(false)
  const lookups = useMemo(() => {
    const issues = new Map<string, string[]>(), changes = new Map<string, NonNullable<typeof preview>['changes'][number]>()
    for (const issue of preview?.issues ?? []) {
      const key = `${issue.row}:${issue.column}`
      issues.set(key, [...(issues.get(key) ?? []), issue.message])
    }
    for (const change of preview?.changes ?? []) changes.set(`${change.row}:${change.column}`, change)
    return { issues, changes }
  }, [preview])

  function close() {
    if (committing.current) return
    generation.current++
    setTable(null); setPreview(null); setError(''); setSuccess(''); setFileName(''); setReviewed(false); setBusy(false)
    onClose()
  }
  async function report(data: BidImportTable, result: BidImportPreview) {
    try { await downloadBinaryFile('bid-import-failed.xlsx', failedBidReport(data, result), WORKBOOK_MIME) }
    catch { setError('The failed report could not be downloaded. Use Download failed report to retry.') }
  }
  async function upload(file: File | undefined) {
    if (!file || committing.current) return
    const current = ++generation.current
    setBusy(true); setTable(null); setPreview(null); setReviewed(false); setError(''); setSuccess(''); setFileName(file.name)
    let data: BidImportTable | null = null
    try {
      if (!/\.(xlsx|xls|csv)$/i.test(file.name)) throw new Error('Choose an .xlsx, .xls or .csv file.')
      if (file.size > MAX_BID_FILE_BYTES) throw new Error('File exceeds 5 MB. Split it into smaller batches.')
      data = parseBidWorkbook(await file.arrayBuffer())
      const result = await repository.previewBidImport({ table: data })
      if (current !== generation.current) return
      setTable(data); setPreview(result)
      if (!result.valid) await report(data, result)
    } catch (e) {
      if (current !== generation.current) return
      const message = e instanceof Error ? e.message : 'Unable to read or validate this file. Correct it and retry.'
      // Even unreadable/oversized files receive a usable failed report.
      data ??= { headers: ['File'], rows: [[file.name]] }
      const result: BidImportPreview = { valid: false, rowCount: data.rows.length, issues: [{ row: 1, column: 0, message }], changes: [], prepared: [] }
      setError(message); setTable(data); setPreview(result)
      await report(data, result)
    } finally { if (current === generation.current) setBusy(false) }
  }
  async function commit() {
    if (!table || !preview?.valid || !reviewed || committing.current) return
    committing.current = true
    setBusy(true); setError('')
    try {
      const result = await importBids.mutateAsync({ table })
      if (result.status === 'rejected') {
        setPreview(result.preview); setReviewed(false)
        setError('Live data changed or validation failed. Nothing was added; review the failed report.')
        await report(table, result.preview)
      } else {
        setSuccess(`${result.count} bids added. Existing bids were preserved.`)
        setTable(null); setPreview(null); setReviewed(false)
      }
    } catch (e) {
      // A network error can occur AFTER the server commits. Never retry automatically;
      // a manual retry is revalidated against current live IDs/names.
      setError(`${e instanceof Error ? e.message : 'Import could not be confirmed.'} Refresh the tracker before retrying. No automatic retry was made.`)
      setReviewed(false)
    } finally { committing.current = false; setBusy(false) }
  }
  return <Dialog open={open} onClose={close} title="Import bids" size="xl" description="Upload → validate in sideload → review → add the complete batch."
    footer={<><Button disabled={busy} onClick={close}>Close</Button><Button variant="primary" disabled={busy || !preview?.valid || !reviewed} onClick={() => void commit()}>{busy ? 'Working…' : `Add all ${preview?.rowCount ?? 0} bids`}</Button></>}>
    <div className="space-y-4">
      <p className="text-sm text-muted">Department is optional. Blank details can be completed later using the red exclamation beside a bid’s star. Invalid values, unknown columns or duplicates block the entire file.</p>
      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={busy} onClick={() => void downloadBinaryFile('bid-import-template.xlsx', bidTemplate({ existing: [], people: [], states: [], departments: [], customFields }), WORKBOOK_MIME).catch(() => setError('Template download failed. Please retry.'))}>Download template</Button>
        <label className="min-w-0 flex-1 text-sm">Choose workbook (maximum 500 bids / 5 MB)
          <input aria-label="Bid import file" type="file" accept=".xlsx,.xls,.csv" disabled={busy} className="mt-1 block w-full rounded-lg border border-line bg-white p-2" onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; void upload(f) }} />
        </label>
      </div>
      {fileName && <p className="break-all text-sm text-muted">{fileName}</p>}
      {busy && <p role="status" className="text-sm">Validating or saving the complete batch…</p>}
      {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
      {success && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-800">{success}</p>}
      {preview && table && <>
        <div className={`rounded-lg border p-3 text-sm ${preview.valid ? 'border-emerald-200 bg-emerald-50' : 'border-red-200 bg-red-50'}`}>
          <strong>{preview.valid ? `${preview.rowCount} bids passed validation — staged only` : `${preview.issues.length} issues — nothing imported`}</strong>
          <p className="mt-1">{preview.valid ? 'Review every row and the formatting changes below. The batch is checked again against live data when you add it.' : 'The failed Excel report highlights rejected cells in red, with comments and an Errors sheet explaining each cause.'}</p>
        </div>
        {!preview.valid && <Button onClick={() => void report(table, preview)}>Download failed report</Button>}
        {preview.issues.length > 0 && <ul className="max-h-40 list-disc space-y-1 overflow-auto pl-5 text-sm text-red-800">{preview.issues.slice(0, 100).map((i, n) => <li key={n}>Row {i.row}, {table.headers[i.column] || `column ${i.column + 1}`}: {i.message}</li>)}{preview.issues.length > 100 && <li>All remaining issues are in the failed report.</li>}</ul>}
        <div className="max-h-64 overflow-auto rounded-lg border border-line">
          <table className="w-full text-left text-xs"><thead className="sticky top-0 bg-panel"><tr><th className="p-2">Excel row</th>{table.headers.map((h, c) => <th key={c} className="min-w-40 p-2">{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((row, r) => <tr key={r} className="border-t border-line"><td className="p-2">{r + 2}</td>{table.headers.map((_, c) => { const issues = [...(lookups.issues.get(`${r + 2}:${c}`) ?? []), ...(lookups.issues.get(`1:${c}`) ?? [])]; const changed = lookups.changes.get(`${r + 2}:${c}`); return <td key={c} className={`max-w-64 whitespace-pre-wrap break-words p-2 ${issues.length ? 'bg-red-100 text-red-900' : changed ? 'bg-amber-50' : ''}`} title={issues.join('\n') || (changed ? `Original: ${changed.before}` : undefined)}>{changed?.after ?? String(row[c] ?? '')}</td> })}</tr>)}</tbody>
          </table>
        </div>
        <details className="text-sm"><summary className="cursor-pointer font-medium">{preview.changes.length} formatting changes (review)</summary><ul className="mt-2 max-h-40 space-y-1 overflow-auto">{preview.changes.map((c, i) => <li key={i}>Row {c.row}, {table.headers[c.column]}: “{c.before}” → “{c.after}”</li>)}</ul></details>
        {preview.valid && <label className="flex items-start gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e => setReviewed(e.target.checked)} className="mt-1" />I reviewed this complete batch and its formatting changes. Add these {preview.rowCount} new bids.</label>}
      </>}
    </div>
  </Dialog>
}
