import { describe, it, expect, vi, beforeEach } from 'vitest'
import { appRouter } from '../index.js'
import { pool } from '../db.js'

// GCS itself is not exercised against a real bucket in this suite — every
// gcs.ts function is mocked, matching this codebase's convention of testing
// against a real Postgres but never a real external cloud dependency (no
// existing test hits real GCS/Firebase either). Task 17/18 extend this mock.
vi.mock('../lib/gcs.js', () => ({
  ALLOWED_DOCUMENT_CONTENT_TYPES: ['application/pdf', 'image/jpeg', 'image/png',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'],
  MAX_DOCUMENT_SIZE_BYTES: 50 * 1024 * 1024,
  getSignedUploadUrl: vi.fn(async (path: string) => `https://signed-upload.example/${path}`),
  getSignedDownloadUrl: vi.fn(async (path: string) => `https://signed-download.example/${path}`),
  getObjectMetadata: vi.fn(async () => ({ size: 1024, contentType: 'application/pdf' })),
  moveObject: vi.fn(async () => undefined),
  deleteObject: vi.fn(async () => undefined),
}))

describe('documents router', () => {
  let opportunityId: string
  let bidId: string

  beforeEach(async () => {
    await pool.query('DELETE FROM document_citations')
    await pool.query('DELETE FROM documents')
    await pool.query('DELETE FROM bids')
    await pool.query('DELETE FROM opportunity_stage_changes')
    await pool.query('DELETE FROM opportunities')
    await pool.query('DELETE FROM employees')
    await pool.query('DELETE FROM hierarchy_nodes')
    const caller = appRouter.createCaller({})
    const dept = (await caller.hierarchy.createNode({ domain: 'org', typeKey: 'department', parentId: null, stateCode: 27, name: 'Dept' })).id
    opportunityId = (await caller.opportunities.create({ departmentId: dept, opportunityName: 'Tender' })).id
    bidId = (await caller.bids.create({ opportunityId })).id
  })

  it('rejects a disallowed content type up front, before minting a URL', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'malware.exe', contentType: 'application/x-msdownload', sizeBytes: 100 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects a claimed size over the 50MB limit up front', async () => {
    const caller = appRouter.createCaller({})
    await expect(
      caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'huge.pdf', contentType: 'application/pdf', sizeBytes: 51 * 1024 * 1024 })
    ).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('returns a signed upload URL and an uploadId for a valid request', async () => {
    const caller = appRouter.createCaller({})
    const result = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'DRDO_SAG_AI_Tender_2026.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    expect(result.uploadUrl).toContain('bid-tracker/_pending/')
    expect(result.uploadId).toBeTruthy()
  })

  it('confirms an upload, moving the object and inserting a documents row with GCS-verified metadata', async () => {
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'Tender.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    const doc = await caller.documents.confirmUpload({ uploadId })
    expect(doc.contentType).toBe('application/pdf') // from the mocked getObjectMetadata, not the original request
    expect(doc.sizeBytes).toBe(1024) // ditto
  })

  it('rejects and deletes the object when the actual GCS metadata violates the size/type limit even though the request claimed a valid one', async () => {
    const { getObjectMetadata, deleteObject } = await import('../lib/gcs.js')
    vi.mocked(getObjectMetadata).mockResolvedValueOnce({ size: 999_999_999, contentType: 'application/pdf' })
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({
      entityType: 'bid', entityId: bidId, filename: 'Lied.pdf', contentType: 'application/pdf', sizeBytes: 2048,
    })
    await expect(caller.documents.confirmUpload({ uploadId })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(deleteObject).toHaveBeenCalled()
  })

  it('rejects confirming an unknown/expired uploadId', async () => {
    const caller = appRouter.createCaller({})
    await expect(caller.documents.confirmUpload({ uploadId: 'no-such-id' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('rejects a second confirm for the same (entityType, entityId, filename, version) — no orphaned object at the canonical path from the loser', async () => {
    const caller = appRouter.createCaller({})
    const first = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Dup.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    await caller.documents.confirmUpload({ uploadId: first.uploadId })
    const second = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Dup.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    const { deleteObject } = await import('../lib/gcs.js')
    vi.mocked(deleteObject).mockClear()
    await expect(caller.documents.confirmUpload({ uploadId: second.uploadId })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(deleteObject).toHaveBeenCalled() // the loser's now-moved-then-rejected object is cleaned up, not left at the canonical path
  })

  it('lists documents for an entity, deletes one (row then best-effort object), and manages citations', async () => {
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Cited.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    const doc = await caller.documents.confirmUpload({ uploadId })

    const citation = await caller.documents.citations.create({ documentId: doc.id, pageLabel: 'Pg 3', quoteText: 'Total estimated value of procurement: ₹6.20 Crore' })
    let citations = await caller.documents.citations.list({ documentId: doc.id })
    expect(citations).toHaveLength(1)

    let list = await caller.documents.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.map((d: any) => d.id)).toContain(doc.id)

    await caller.documents.delete({ id: doc.id })
    list = await caller.documents.listFor({ entityType: 'bid', entityId: bidId })
    expect(list.map((d: any) => d.id)).not.toContain(doc.id)
    citations = await caller.documents.citations.list({ documentId: doc.id })
    expect(citations).toHaveLength(0) // cascaded

    const { deleteObject } = await import('../lib/gcs.js')
    expect(deleteObject).toHaveBeenCalledWith(doc.storagePath)
  })

  it('getDownloadUrl returns a signed URL for an existing document, and NOT_FOUND for an unknown id', async () => {
    const caller = appRouter.createCaller({})
    const { uploadId } = await caller.documents.requestUploadUrl({ entityType: 'bid', entityId: bidId, filename: 'Readable.pdf', contentType: 'application/pdf', sizeBytes: 1024 })
    const doc = await caller.documents.confirmUpload({ uploadId })
    const { url } = await caller.documents.getDownloadUrl({ id: doc.id })
    expect(url).toContain('https://signed-download.example/')
    expect(url).toContain('Readable.pdf')
    await expect(caller.documents.getDownloadUrl({ id: '00000000-0000-4000-8000-000000000099' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
