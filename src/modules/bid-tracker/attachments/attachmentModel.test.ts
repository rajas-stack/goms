import { beforeEach, describe, expect, it } from 'vitest'
import { normalizeDocumentFiling } from '@goms/domain'
import { repository, resetLocalData } from '@/data/repository'
import type { BidCorrigendum, BidDocument } from '@/lib/types'
import { DEFAULT_REGISTER } from '../corrigenda/model'
import { attachmentFileError, groupAttachments } from './attachmentModel'

const doc = (id: string, extra: Partial<BidDocument> = {}): BidDocument => ({
  id, entityType: 'bid', entityId: 'b1', filename: `${id}.pdf`, storagePath: '', version: 'v1.0', contentType: 'application/pdf',
  sizeBytes: 1000, uploadedBy: null, uploadedAt: '2026-10-01T00:00:00Z', batch: 'tender', category: 'other_tender', ...extra,
})
const cor = (n: number, sourceDocumentId: string | null): BidCorrigendum => ({
  id: `c${n}`, bidId: 'b1', corrigendumNumber: n, sourceDocumentId, detectedAt: '', reviewedAt: null, reviewedBy: null,
  status: 'reviewed', ...DEFAULT_REGISTER, changes: [],
})
const namesIn = (groups: ReturnType<typeof groupAttachments>, batch: string, category: string) =>
  groups.find((b) => b.batch === batch)!.categories.find((c) => c.category === category)!.items.map((i) => i.document.id)

describe('attachment grouping', () => {
  it('files documents into Batch 1 / Batch 2 categories', () => {
    const groups = groupAttachments([
      doc('rfp', { category: 'rfp' }), doc('boq', { category: 'boq' }),
      doc('prebid', { batch: 'post_publication', category: 'prebid_response' }),
    ], [])
    expect(groups.map((g) => [g.batch, g.count])).toEqual([['tender', 2], ['post_publication', 1]])
    expect(namesIn(groups, 'tender', 'rfp')).toEqual(['rfp'])
    expect(namesIn(groups, 'post_publication', 'prebid_response')).toEqual(['prebid'])
    expect(groups[0].categories.map((c) => c.label)).toEqual(['RFP', 'Synopsis', 'BoQ', 'Other tender documents'])
  })

  it('puts every corrigendum source document under Batch 2 › Corrigendum, labelled C1/C2', () => {
    const groups = groupAttachments([doc('cor2'), doc('cor1', { category: 'rfp' })], [cor(2, 'cor2'), cor(1, 'cor1')])
    expect(namesIn(groups, 'post_publication', 'corrigendum')).toEqual(['cor1', 'cor2'])
    expect(groups[1].categories.find((c) => c.category === 'corrigendum')!.items.map((i) => i.corrigendumCodes)).toEqual([['C1'], ['C2']])
    expect(groups[0].count).toBe(0)
  })

  it('defaults documents saved before batches existed to Batch 1 / Other', () => {
    expect(normalizeDocumentFiling(undefined, undefined)).toEqual({ batch: 'tender', category: 'other_tender' })
    expect(normalizeDocumentFiling('post_publication', 'rfp')).toEqual({ batch: 'post_publication', category: 'other_post' })
    const legacy = { ...doc('old') } as Partial<BidDocument>
    delete legacy.batch; delete legacy.category
    expect(namesIn(groupAttachments([legacy as BidDocument], []), 'tender', 'other_tender')).toEqual(['old'])
  })

  it('validates file type and size like the other uploads', () => {
    expect(attachmentFileError({ type: 'application/pdf', size: 10 })).toBeNull()
    expect(attachmentFileError({ type: 'application/zip', size: 10 })).toMatch(/Only PDF/)
    expect(attachmentFileError({ type: 'application/pdf', size: 51 * 1024 * 1024 })).toMatch(/50 MB/)
  })
})

describe('attachments in the local repository', () => {
  beforeEach(() => resetLocalData())

  async function upload(entityId: string, extra: Record<string, unknown> = {}) {
    const { uploadId } = await repository.requestDocumentUploadUrl({
      entityType: 'bid', entityId, filename: 'RFP.pdf', contentType: 'application/pdf', sizeBytes: 2048, ...extra,
    })
    return repository.confirmDocumentUpload(uploadId)
  }

  it('stores batch/category on upload, re-files and deletes', async () => {
    const created = await upload('b-local', { batch: 'tender', category: 'rfp' })
    expect(created).toMatchObject({ batch: 'tender', category: 'rfp' })
    const moved = await repository.updateDocumentFiling({ id: created.id, batch: 'post_publication', category: 'addendum' })
    expect(moved).toMatchObject({ batch: 'post_publication', category: 'addendum' })
    expect((await repository.listDocuments('bid', 'b-local'))[0].category).toBe('addendum')
    await repository.deleteDocument(created.id)
    expect(await repository.listDocuments('bid', 'b-local')).toEqual([])
  })

  it('defaults an upload with no filing to Batch 1 / Other and rejects mismatched filings and bad files', async () => {
    expect(await upload('b-local')).toMatchObject({ batch: 'tender', category: 'other_tender' })
    await expect(upload('b-local', { batch: 'tender', category: 'corrigendum' })).rejects.toThrow(/belongs to the selected batch/)
    await expect(upload('b-local', { contentType: 'application/zip' })).rejects.toThrow(/Unsupported file type/)
    await expect(upload('b-local', { sizeBytes: 60 * 1024 * 1024 })).rejects.toThrow(/50 MB/)
    const doc1 = await upload('b-local')
    await expect(repository.updateDocumentFiling({ id: doc1.id, batch: 'tender', category: 'addendum' })).rejects.toThrow(/belongs to the selected batch/)
  })
})
