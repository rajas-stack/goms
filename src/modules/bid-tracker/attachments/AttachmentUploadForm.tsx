import { useRef, useState } from 'react'
import {
  BATCH_CATEGORIES, DOCUMENT_BATCHES, DOCUMENT_BATCH_LABELS, DOCUMENT_CATEGORY_LABELS,
  type DocumentBatch, type DocumentCategory,
} from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useDocumentMutations } from '@/lib/api'
import { ATTACHMENT_TYPES, attachmentFileError } from './attachmentModel'

/** Pick batch + category, then a file. Uses the same two-step upload as the
 *  rest of the bid's documents (signed URL, then confirm). */
export function AttachmentUploadForm({ bidId, onError }: { bidId: string; onError: (message: string | null) => void }) {
  const { requestUploadUrl, confirmUpload } = useDocumentMutations('bid', bidId)
  const [batch, setBatch] = useState<DocumentBatch>('tender')
  const [category, setCategory] = useState<DocumentCategory>('rfp')
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const chooseBatch = (next: DocumentBatch) => { setBatch(next); setCategory(BATCH_CATEGORIES[next][0]) }

  async function upload(file: File) {
    onError(null)
    const invalid = attachmentFileError(file)
    if (invalid) { onError(invalid); return }
    setBusy(true)
    try {
      const { uploadId, uploadUrl } = await requestUploadUrl.mutateAsync({
        entityType: 'bid', entityId: bidId, filename: file.name, contentType: file.type, sizeBytes: file.size, batch, category,
      })
      // Local (no-backend) mode hands out a placeholder URL and stores only metadata.
      if (!uploadUrl.startsWith('local://')) {
        const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`)
      }
      await confirmUpload.mutateAsync(uploadId)
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Select aria-label="Upload to batch" className="h-8 w-auto py-0 text-[13px]" value={batch} onChange={(e) => chooseBatch(e.target.value as DocumentBatch)}>
        {DOCUMENT_BATCHES.map((b) => <option key={b} value={b}>{DOCUMENT_BATCH_LABELS[b]}</option>)}
      </Select>
      <Select aria-label="Upload as category" className="h-8 w-auto py-0 text-[13px]" value={category} onChange={(e) => setCategory(e.target.value as DocumentCategory)}>
        {BATCH_CATEGORIES[batch].map((c) => <option key={c} value={c}>{DOCUMENT_CATEGORY_LABELS[c]}</option>)}
      </Select>
      <Button size="sm" variant="primary" disabled={busy} onClick={() => fileRef.current?.click()}>
        <Icon name={busy ? 'Loader' : 'Upload'} size={13} className={busy ? 'animate-spin' : undefined} /> {busy ? 'Uploading…' : 'Upload'}
      </Button>
      <input ref={fileRef} type="file" className="hidden" aria-label="Upload attachment" accept={ATTACHMENT_TYPES.join(',')}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
    </div>
  )
}
