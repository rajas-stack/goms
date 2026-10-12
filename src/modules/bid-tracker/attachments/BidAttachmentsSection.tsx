import { useMemo, useState } from 'react'
import { ConfirmDeleteDialog } from '@/components/ui/ConfirmDeleteDialog'
import { Icon } from '@/components/ui/Icon'
import { useBidCorrigenda, useDeliveryTeamMembers, useDocumentMutations, useDocuments } from '@/lib/api'
import { useAllowed } from '@/lib/permissions'
import { cn } from '@/lib/utils'
import { AttachmentRow } from './AttachmentRow'
import { AttachmentUploadForm } from './AttachmentUploadForm'
import { groupAttachments, type AttachmentBatchGroup } from './attachmentModel'

const OPEN_KEY = 'goms:bid-attachments-open'
const readOpen = (): boolean => { try { return localStorage.getItem(OPEN_KEY) !== '0' } catch { return true } }
const writeOpen = (open: boolean) => { try { localStorage.setItem(OPEN_KEY, open ? '1' : '0') } catch { /* per-viewer convenience only */ } }

const BATCH_ACCENT: Record<AttachmentBatchGroup['batch'], string> = {
  tender: 'border-l-goms-navy', post_publication: 'border-l-blue',
}

/** Every attachment of the bid, filed into Batch 1 (tender) and Batch 2
 *  (post-publication). Rendered once below every bid tab. */
export function BidAttachmentsSection({ bidId }: { bidId: string }) {
  const { data: documents = [], isLoading } = useDocuments('bid', bidId)
  const { data: corrigenda = [] } = useBidCorrigenda(bidId)
  const { data: members = [] } = useDeliveryTeamMembers()
  const { remove, download, updateFiling } = useDocumentMutations('bid', bidId)
  const canUpload = useAllowed('bid.documents', 'create')
  const canRefile = useAllowed('bid.documents', 'update', 'doc.upload')
  const [open, setOpen] = useState(readOpen)
  const [error, setError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<{ id: string; filename: string } | null>(null)
  const batches = useMemo(() => groupAttachments(documents, corrigenda), [documents, corrigenda])
  const uploaderName = (email: string | null) => (email ? members.find((m) => m.email === email)?.name ?? email : 'Local user')

  const toggle = () => { setOpen(!open); writeOpen(!open) }
  const run = async (action: () => Promise<unknown>, fallback: string) => {
    setError(null)
    try { await action() } catch (e) { setError(e instanceof Error ? e.message : fallback) }
  }
  const openDocument = (id: string) => run(async () => {
    const url = await download.mutateAsync(id)
    // Local (no-backend) mode keeps no file bytes, so there is nothing to open.
    if (url.startsWith('local://')) throw new Error('Local mode keeps only document details, not the file itself.')
    window.open(url, '_blank', 'noopener')
  }, 'Could not open the document.')

  return (
    <section aria-labelledby="bid-attachments-heading" data-testid="bid-attachments" className="border-t-4 border-line bg-panel/50 px-4 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={toggle} aria-expanded={open} aria-controls="bid-attachments-body"
          className="inline-flex items-center gap-2 rounded-md text-left focus-visible:focus-ring">
          <Icon name={open ? 'ChevronDown' : 'ChevronRight'} size={16} className="text-muted" />
          <h2 id="bid-attachments-heading" className="font-display text-[15px] font-semibold text-ink-900">Attachments</h2>
          <span className="rounded-full bg-white px-2 text-[12px] font-medium tabular-nums text-muted shadow-sm">{documents.length}</span>
        </button>
        {open && canUpload && <AttachmentUploadForm bidId={bidId} onError={setError} />}
      </div>
      {open && (
        <div id="bid-attachments-body" className="mt-3 space-y-3">
          {error && <p role="alert" className="text-[13px] text-crimson">{error}</p>}
          {isLoading && <p className="text-[13px] text-muted">Loading attachments…</p>}
          <div className="grid gap-3 xl:grid-cols-2">
            {batches.map((b) => (
              <section key={b.batch} aria-label={b.label} data-testid={`attachment-batch-${b.batch}`}
                className={cn('min-w-0 rounded-xl border border-l-4 border-line bg-white shadow-sm', BATCH_ACCENT[b.batch])}>
                <header className="flex items-baseline justify-between gap-2 border-b border-line px-3 py-2">
                  <h3 className="text-[13px] font-semibold text-ink-900">{b.label}</h3>
                  <span className="text-[12px] tabular-nums text-muted">{b.count} file{b.count === 1 ? '' : 's'}</span>
                </header>
                {b.categories.map((g) => (
                  <div key={g.category} className="border-b border-line last:border-b-0">
                    <h4 className="bg-panel/60 px-3 py-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted">
                      {g.label} <span className="tabular-nums">· {g.items.length}</span>
                    </h4>
                    {g.items.length === 0
                      ? <p className="px-3 py-1.5 text-[12px] italic text-muted">None yet</p>
                      : <ul className="divide-y divide-line">
                          {g.items.map((item) => (
                            <AttachmentRow key={item.document.id} item={item} uploader={uploaderName(item.document.uploadedBy)} canRefile={canRefile}
                              onOpen={(id) => void openDocument(id)} onDelete={(id, filename) => setDeleting({ id, filename })}
                              onRefile={(id, batch, category) => void run(() => updateFiling.mutateAsync({ id, batch, category }), 'Could not move the document.')} />
                          ))}
                        </ul>}
                  </div>
                ))}
              </section>
            ))}
          </div>
        </div>
      )}
      <ConfirmDeleteDialog open={!!deleting} onClose={() => setDeleting(null)} itemLabel={deleting?.filename ?? 'this attachment'}
        onConfirm={async () => { if (deleting) await remove.mutateAsync(deleting.id); setDeleting(null) }} />
    </section>
  )
}
