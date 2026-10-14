/** Bid attachment batches. Batch 1 holds the tender as published; Batch 2
 *  everything issued after publication. Stored ids are snake_case and must
 *  stay in sync with the CHECK constraints in the documents migration. */

export const DOCUMENT_BATCHES = ['tender', 'post_publication'] as const
export type DocumentBatch = (typeof DOCUMENT_BATCHES)[number]
export const DOCUMENT_BATCH_LABELS: Record<DocumentBatch, string> = {
  tender: 'Batch 1 — Tender documents', post_publication: 'Batch 2 — Post-publication',
}

export const DOCUMENT_CATEGORIES = [
  'rfp', 'synopsis', 'boq', 'other_tender', 'prebid_response', 'corrigendum', 'addendum', 'other_post',
] as const
export type DocumentCategory = (typeof DOCUMENT_CATEGORIES)[number]
export const DOCUMENT_CATEGORY_LABELS: Record<DocumentCategory, string> = {
  rfp: 'RFP', synopsis: 'Synopsis', boq: 'BoQ', other_tender: 'Other tender documents',
  prebid_response: 'Pre-bid responses', corrigendum: 'Corrigendum', addendum: 'Addendum', other_post: 'Other',
}

/** Categories offered in each batch, in display order. */
export const BATCH_CATEGORIES: Record<DocumentBatch, readonly DocumentCategory[]> = {
  tender: ['rfp', 'synopsis', 'boq', 'other_tender'],
  post_publication: ['prebid_response', 'corrigendum', 'addendum', 'other_post'],
}

/** Where a document with no stored batch/category (uploaded before batches existed) is filed. */
export const DEFAULT_DOCUMENT_BATCH: DocumentBatch = 'tender'
export const DEFAULT_DOCUMENT_CATEGORY: DocumentCategory = 'other_tender'

export const isDocumentBatch = (v: unknown): v is DocumentBatch => (DOCUMENT_BATCHES as readonly unknown[]).includes(v)
export const isDocumentCategory = (v: unknown): v is DocumentCategory => (DOCUMENT_CATEGORIES as readonly unknown[]).includes(v)

/** True when `category` belongs to `batch`. */
export const categoryFitsBatch = (batch: DocumentBatch, category: DocumentCategory): boolean => BATCH_CATEGORIES[batch].includes(category)

/** A valid batch/category pair from possibly-missing or invalid stored values. */
export function normalizeDocumentFiling(batch: unknown, category: unknown): { batch: DocumentBatch; category: DocumentCategory } {
  const b = isDocumentBatch(batch) ? batch : DEFAULT_DOCUMENT_BATCH
  if (isDocumentCategory(category) && categoryFitsBatch(b, category)) return { batch: b, category }
  return { batch: b, category: b === 'tender' ? DEFAULT_DOCUMENT_CATEGORY : 'other_post' }
}
