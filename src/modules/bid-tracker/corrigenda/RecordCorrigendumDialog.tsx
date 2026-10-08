import { useRef, useState } from 'react'
import { corrigendumHeading, slugifyFieldKey } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Dialog } from '@/components/ui/Dialog'
import { Field, Select } from '@/components/ui/Field'
import { Icon } from '@/components/ui/Icon'
import { useBidCorrigendaMutations, useDocumentMutations, useDocuments } from '@/lib/api'
import type { CorrigendumRegister } from '@/lib/types'
import { ClauseChangeEditor, emptyClauseDraft, type ClauseDraft } from './ClauseChangeEditor'
import { DEFAULT_REGISTER, type CorrigendumChangeInput } from './model'
import { RegisterFields } from './RegisterFields'
import type { ClauseHistory } from './tenderPosition'

const ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']
const MAX_BYTES = 50 * 1024 * 1024

/** A stable key for a newly tracked clause, unique among `taken`. */
function newClauseKey(d: ClauseDraft, taken: Set<string>): string {
  const prefix = `${d.module}.`
  const takenSlugs = new Set([...taken].filter((k) => k.startsWith(prefix)).map((k) => k.slice(prefix.length)))
  return prefix + slugifyFieldKey(d.title, takenSlugs)
}

function toChangeInputs(drafts: ClauseDraft[], clauses: ClauseHistory[]): CorrigendumChangeInput[] {
  const taken = new Set(clauses.map((c) => c.key))
  return drafts.map((d) => {
    const key = d.existingKey || newClauseKey(d, taken)
    taken.add(key)
    return {
      fieldKey: key, currentValue: d.original.trim(), proposedValue: d.modified.trim(), kind: 'clause',
      clauseTitle: d.title.trim(), affectedModule: d.module, classification: d.classification, impactLevel: d.impact, sourceRef: d.sourceRef.trim(),
    }
  })
}

/** Records a new corrigendum: register entry + clause-level changes. The
 *  number is automatic (next C-number); nothing already recorded is edited. */
export function RecordCorrigendumDialog({ bidId, nextNumber, clauses, onClose, onCreated }: {
  bidId: string; nextNumber: number; clauses: ClauseHistory[]; onClose: () => void; onCreated: (id: string) => void
}) {
  const { create } = useBidCorrigendaMutations(bidId)
  const { data: documents = [] } = useDocuments('bid', bidId)
  const { requestUploadUrl, confirmUpload } = useDocumentMutations('bid', bidId)
  const fileRef = useRef<HTMLInputElement>(null)
  const [register, setRegister] = useState<CorrigendumRegister>(DEFAULT_REGISTER)
  const [documentId, setDocumentId] = useState('')
  const [drafts, setDrafts] = useState<ClauseDraft[]>([emptyClauseDraft()])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const tracked = clauses.filter((c) => c.kind === 'clause')
  const usedKeys = new Set(drafts.map((d) => d.existingKey).filter(Boolean))
  const valid = drafts.every((d) => d.title.trim() && (d.original.trim() || d.modified.trim()) && d.original.trim() !== d.modified.trim())

  async function upload(file: File) {
    setError(null)
    if (!ALLOWED_TYPES.includes(file.type)) { setError('Upload a PDF, JPEG, PNG or Word (.docx) file.'); return }
    if (file.size > MAX_BYTES) { setError('Files can be at most 50 MB.'); return }
    setUploading(true)
    try {
      const { uploadId, uploadUrl } = await requestUploadUrl.mutateAsync({ entityType: 'bid', entityId: bidId, filename: file.name, contentType: file.type, sizeBytes: file.size })
      // Local (no-backend) mode hands out a placeholder URL and keeps only metadata.
      if (!uploadUrl.startsWith('local://')) {
        const res = await fetch(uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type }, body: file })
        if (!res.ok) throw new Error(`Upload failed (${res.status}).`)
      }
      const doc = await confirmUpload.mutateAsync(uploadId)
      setDocumentId(doc.id)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed.')
    } finally {
      setUploading(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function submit() {
    setError(null)
    try {
      const created = await create.mutateAsync({
        bidId, corrigendumNumber: nextNumber, sourceDocumentId: documentId || undefined,
        register: { ...register, affectedSections: register.affectedSections.length ? register.affectedSections : [...new Set(drafts.map((d) => d.module))] },
        changes: toChangeInputs(drafts, clauses),
      })
      onCreated(created.id)
      onClose()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not record the corrigendum.')
    }
  }

  return (
    <Dialog
      open onClose={onClose} size="xl" title={`Record ${corrigendumHeading(nextNumber)}`}
      description="Register the corrigendum and each clause it changes. Earlier versions are kept — nothing is overwritten."
      footer={<>
        <Button variant="secondary" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!valid || create.isPending || uploading} onClick={submit}>Record corrigendum</Button>
      </>}
    >
      <div className="space-y-5">
        <RegisterFields value={register} onChange={setRegister} />
        <Field label="Corrigendum document">
          <div className="flex flex-wrap items-center gap-2">
            <Select aria-label="Corrigendum document" className="min-w-0 flex-1" value={documentId} onChange={(e) => setDocumentId(e.target.value)}>
              <option value="">— None —</option>
              {documents.map((d) => <option key={d.id} value={d.id}>{d.filename}</option>)}
            </Select>
            <Button variant="secondary" size="sm" disabled={uploading} onClick={() => fileRef.current?.click()}>
              <Icon name="Upload" size={13} /> {uploading ? 'Uploading…' : 'Upload'}
            </Button>
            <input ref={fileRef} type="file" className="hidden" aria-label="Upload corrigendum document" accept={ALLOWED_TYPES.join(',')}
              onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} />
          </div>
        </Field>
        <div className="space-y-3">
          {drafts.map((d, i) => (
            <ClauseChangeEditor
              key={i} index={i} draft={d} clauses={tracked} usedKeys={usedKeys}
              onChange={(next) => setDrafts((all) => all.map((x, j) => (j === i ? next : x)))}
              onRemove={drafts.length > 1 ? () => setDrafts((all) => all.filter((_, j) => j !== i)) : undefined}
            />
          ))}
          <Button variant="secondary" size="sm" onClick={() => setDrafts((all) => [...all, emptyClauseDraft()])}><Icon name="Plus" size={13} /> Add another change</Button>
        </div>
        {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
      </div>
    </Dialog>
  )
}
