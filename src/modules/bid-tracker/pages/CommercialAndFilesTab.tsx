import { useRef, useState } from 'react'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { useDocumentMutations, useDocuments } from '@/lib/api'
import type { BidGridRow } from '@/lib/types'

// Mirrors the API's allow-list (spec §14): rejecting early gives a clear message
// instead of a failed upload, but the API re-checks the real object regardless.
const ALLOWED_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
]
const MAX_BYTES = 50 * 1024 * 1024

const formatSize = (bytes: number) => (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)
const money = (amount: string, unit: string) => (amount ? `${amount} ${unit}` : '—')

/** Commercial figures from the opportunity (read-only here — value and EMD are
 *  protected-value candidates, edited via the Protected Values tab / dialogs)
 *  and the bid's source documents with upload and delete. */
export function CommercialAndFilesTab({ bidId, opportunity }: {
  bidId: string
  opportunity: Pick<BidGridRow, 'valueAmount' | 'valueUnit' | 'emdAmount' | 'emdUnit'>
}) {
  const { data: documents = [], isLoading } = useDocuments('bid', bidId)
  const { requestUploadUrl, confirmUpload, remove } = useDocumentMutations('bid', bidId)
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleUpload(file: File) {
    setError(null)
    if (!ALLOWED_TYPES.includes(file.type)) { setError('Only PDF, JPEG, PNG, Word (.docx) and Excel (.xlsx) files can be uploaded.'); return }
    if (file.size > MAX_BYTES) { setError('Files can be at most 50 MB.'); return }
    setBusy(true)
    try {
      const { uploadId, uploadUrl } = await requestUploadUrl.mutateAsync({
        entityType: 'bid', entityId: bidId, filename: file.name, contentType: file.type, sizeBytes: file.size,
      })
      // Local (no-backend) mode hands out a placeholder URL and stores only metadata.
      if (!uploadUrl.startsWith('local://')) {
        const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`)
      }
      await confirmUpload.mutateAsync(uploadId)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (inputRef.current) inputRef.current.value = ''
    }
  }

  return (
    <div className="space-y-6 p-4" data-testid="commercial-tab">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Estimated Project Cost</div>
          <div className="text-lg font-semibold text-ink">{money(opportunity.valueAmount, opportunity.valueUnit)}</div>
        </div>
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">EMD / Tender Fee</div>
          <div className="text-lg font-semibold text-ink">{money(opportunity.emdAmount, opportunity.emdUnit)}</div>
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">Source Documents</div>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => inputRef.current?.click()}>
            <Icon name="Upload" size={14} /> {busy ? 'Uploading…' : 'Upload'}
          </Button>
          <input
            ref={inputRef} type="file" className="hidden" aria-label="Upload document" accept={ALLOWED_TYPES.join(',')}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleUpload(f) }}
          />
        </div>
        {error && <p role="alert" className="mb-2 text-[13px] text-crimson">{error}</p>}
        {!isLoading && documents.length === 0 && <p className="text-sm text-muted">No documents uploaded yet.</p>}
        <ul className="divide-y divide-line">
          {documents.map((d) => (
            <li key={d.id} className="flex items-center gap-2 py-2" data-testid="document-row">
              <Icon name="FileText" size={14} className="text-muted" />
              <span className="min-w-0 flex-1 truncate text-sm text-ink">{d.filename}</span>
              <span className="text-[12px] text-muted">{d.version} · {formatSize(d.sizeBytes)}</span>
              <Button
                variant="ghost" size="icon" aria-label={`Delete ${d.filename}`}
                onClick={() => { if (window.confirm(`Delete "${d.filename}"?`)) remove.mutate(d.id) }}
              >
                <Icon name="Trash2" size={14} />
              </Button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}
