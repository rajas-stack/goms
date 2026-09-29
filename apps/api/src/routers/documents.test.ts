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
})
