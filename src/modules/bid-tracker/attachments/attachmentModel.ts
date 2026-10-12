import {
  BATCH_CATEGORIES, corrigendumCode, DOCUMENT_BATCHES, DOCUMENT_BATCH_LABELS, DOCUMENT_CATEGORY_LABELS, normalizeDocumentFiling,
  type DocumentBatch, type DocumentCategory,
} from '@goms/domain'
import type { BidCorrigendum, BidDocument } from '@/lib/types'

/** Grouping of a bid's attachments into Batch 1 (tender) and Batch 2
 *  (post-publication). Pure. A document that is a corrigendum's source
 *  document is always filed under Batch 2 › Corrigendum, labelled C1/C2…,
 *  whatever category it was uploaded with. */

export interface AttachmentItem {
  document: BidDocument
  /** ["C1"] when this document is a corrigendum's source document. */
  corrigendumCodes: string[]
}
export interface AttachmentCategoryGroup { category: DocumentCategory; label: string; items: AttachmentItem[] }
export interface AttachmentBatchGroup { batch: DocumentBatch; label: string; count: number; categories: AttachmentCategoryGroup[] }

export function corrigendumCodesByDocument(corrigenda: readonly BidCorrigendum[]): Map<string, string[]> {
  return [...corrigenda]
    .sort((a, b) => a.corrigendumNumber - b.corrigendumNumber)
    .reduce((map, c) => (c.sourceDocumentId
      ? new Map(map).set(c.sourceDocumentId, [...(map.get(c.sourceDocumentId) ?? []), corrigendumCode(c.corrigendumNumber)])
      : map), new Map<string, string[]>())
}

/** Effective filing: corrigendum source documents go to Batch 2 › Corrigendum. */
export function filingOf(document: BidDocument, codes: readonly string[]): { batch: DocumentBatch; category: DocumentCategory } {
  if (codes.length) return { batch: 'post_publication', category: 'corrigendum' }
  return normalizeDocumentFiling(document.batch, document.category)
}

/** Every batch and category in display order (empty ones included, so the UI
 *  can show where to upload); items oldest corrigendum first, then newest upload. */
export function groupAttachments(documents: readonly BidDocument[], corrigenda: readonly BidCorrigendum[]): AttachmentBatchGroup[] {
  const codes = corrigendumCodesByDocument(corrigenda)
  const items = documents.map((document): AttachmentItem & { filing: ReturnType<typeof filingOf> } => {
    const c = codes.get(document.id) ?? []
    return { document, corrigendumCodes: c, filing: filingOf(document, c) }
  })
  const order = (a: AttachmentItem, b: AttachmentItem) =>
    (a.corrigendumCodes[0] ?? '').localeCompare(b.corrigendumCodes[0] ?? '', undefined, { numeric: true })
    || b.document.uploadedAt.localeCompare(a.document.uploadedAt)
  return DOCUMENT_BATCHES.map((batch) => {
    const categories = BATCH_CATEGORIES[batch].map((category) => ({
      category, label: DOCUMENT_CATEGORY_LABELS[category],
      items: items.filter((i) => i.filing.batch === batch && i.filing.category === category)
        .map(({ document, corrigendumCodes }) => ({ document, corrigendumCodes })).sort(order),
    }))
    return { batch, label: DOCUMENT_BATCH_LABELS[batch], count: categories.reduce((n, g) => n + g.items.length, 0), categories }
  })
}

export const formatFileSize = (bytes: number): string =>
  (bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`)

/** Mirrors the API allow-list (apps/api/src/lib/gcs.ts) for an early, clear message. */
export const ATTACHMENT_TYPES = [
  'application/pdf', 'image/jpeg', 'image/png',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
] as const
export const ATTACHMENT_MAX_BYTES = 50 * 1024 * 1024

/** null when the file may be uploaded, else the reason it may not. */
export function attachmentFileError(file: Pick<File, 'type' | 'size'>): string | null {
  if (!(ATTACHMENT_TYPES as readonly string[]).includes(file.type)) return 'Only PDF, JPEG, PNG, Word (.docx) and Excel (.xlsx) files can be uploaded.'
  if (file.size > ATTACHMENT_MAX_BYTES) return 'Files can be at most 50 MB.'
  if (file.size <= 0) return 'This file is empty.'
  return null
}
