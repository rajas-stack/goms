import { BATCH_CATEGORIES, DOCUMENT_BATCHES, DOCUMENT_BATCH_LABELS, DOCUMENT_CATEGORY_LABELS, type DocumentBatch, type DocumentCategory } from '@goms/domain'
import { Button } from '@/components/ui/Button'
import { Icon } from '@/components/ui/Icon'
import { PersonName } from '@/components/ui/PersonName'
import { Can } from '@/lib/permissions'
import type { AttachmentItem } from './attachmentModel'
import { formatFileSize } from './attachmentModel'

const DATE = new Intl.DateTimeFormat('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
const fileIcon = (type: string) => (type.includes('spreadsheet') ? 'FileSpreadsheet' : 'FileText')

interface Props {
  item: AttachmentItem
  uploader: string
  canRefile: boolean
  /** The permission tree allows downloading (default true). */
  canDownload?: boolean
  onOpen: (id: string) => void
  onDelete: (id: string, filename: string) => void
  onRefile: (id: string, batch: DocumentBatch, category: DocumentCategory) => void
}

/** One attachment: name (opens it), C-codes, filing, uploader, date, size, actions. */
export function AttachmentRow({ item, uploader, canRefile, canDownload = true, onOpen, onDelete, onRefile }: Props) {
  const d = item.document
  const isCorrigendumSource = item.corrigendumCodes.length > 0
  return (
    <li data-testid="attachment-row" className="flex items-start gap-2.5 px-3 py-2">
      <Icon name={fileIcon(d.contentType)} size={15} className="mt-0.5 shrink-0 text-muted" />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-2">
          <button type="button" onClick={() => onOpen(d.id)} aria-label={`Open ${d.filename}`} title={d.filename}
            className="min-w-0 truncate text-left text-[13px] font-medium text-ink underline decoration-line underline-offset-2 hover:decoration-ink focus-visible:focus-ring">
            {d.filename}
          </button>
          {item.corrigendumCodes.map((code) => (
            <span key={code} className="shrink-0 rounded bg-blue-100 px-1.5 font-mono text-[11px] font-semibold leading-5 text-blue-700">{code}</span>
          ))}
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-muted">
          <PersonName person={{ name: uploader }} size="2xs" nameClassName="text-[12px] text-ink-700" />
          <span className="tabular-nums">{DATE.format(new Date(d.uploadedAt))}</span>
          <span className="tabular-nums">{formatFileSize(d.sizeBytes)}</span>
          {canRefile && !isCorrigendumSource && (
            <select aria-label={`Move ${d.filename} to category`} value={`${d.batch}:${d.category}`} title="Move to another batch or category"
              onChange={(e) => { const [b, c] = e.target.value.split(':'); onRefile(d.id, b as DocumentBatch, c as DocumentCategory) }}
              className="h-6 max-w-[11rem] rounded-md border border-line bg-white px-1 text-[12px] text-ink-700 focus-visible:focus-ring">
              {DOCUMENT_BATCHES.map((b) => (
                <optgroup key={b} label={DOCUMENT_BATCH_LABELS[b]}>
                  {BATCH_CATEGORIES[b].map((c) => <option key={c} value={`${b}:${c}`}>{DOCUMENT_CATEGORY_LABELS[c]}</option>)}
                </optgroup>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-0.5">
        {canDownload && <Button variant="ghost" size="icon" aria-label={`Download ${d.filename}`} title="Open / download" onClick={() => onOpen(d.id)}>
          <Icon name="Download" size={14} />
        </Button>}
        <Can module="bid.documents" action="delete" node="opportunity.bid.attachments">
          <Button variant="ghost" size="icon" aria-label={`Delete ${d.filename}`} title="Delete" onClick={() => onDelete(d.id, d.filename)}>
            <Icon name="Trash2" size={14} />
          </Button>
        </Can>
      </div>
    </li>
  )
}
