-- Up Migration

-- Bid attachments are filed into two batches: Batch 1 'tender' (the tender as
-- published) and Batch 2 'post_publication' (pre-bid responses, corrigenda,
-- addenda...). Keep both CHECK lists in sync with packages/domain/src/bidAttachments.ts.
-- Existing documents default to Batch 1 / Other tender documents.

ALTER TABLE documents
  ADD COLUMN batch    TEXT NOT NULL DEFAULT 'tender'
    CHECK (batch IN ('tender','post_publication')),
  ADD COLUMN category TEXT NOT NULL DEFAULT 'other_tender'
    CHECK (category IN ('rfp','synopsis','boq','other_tender','prebid_response','corrigendum','addendum','other_post'));

ALTER TABLE documents ADD CONSTRAINT documents_batch_category_check CHECK (
  (batch = 'tender' AND category IN ('rfp','synopsis','boq','other_tender'))
  OR (batch = 'post_publication' AND category IN ('prebid_response','corrigendum','addendum','other_post'))
);

-- Down Migration

ALTER TABLE documents DROP CONSTRAINT documents_batch_category_check;
ALTER TABLE documents DROP COLUMN category, DROP COLUMN batch;
