import { afterEach, beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ query: vi.fn(), deleteObject: vi.fn() }))
vi.mock('../db.js', () => ({ pool: { query: mocks.query } }))
vi.mock('../lib/gcs.js', () => ({
  ALLOWED_DOCUMENT_CONTENT_TYPES: [], MAX_DOCUMENT_SIZE_BYTES: 50 * 1024 * 1024,
  getSignedUploadUrl: vi.fn(), getSignedDownloadUrl: vi.fn(), getObjectMetadata: vi.fn(), moveObject: vi.fn(),
  deleteObject: mocks.deleteObject,
}))
import { documentsRouter } from './documents.js'

beforeEach(() => {
  vi.stubEnv('NODE_ENV', 'test')
  vi.stubEnv('SECURITY_ENFORCEMENT_ENABLED', 'false')
  vi.stubEnv('AUTH_ENFORCEMENT_ENABLED', 'false')
  vi.stubEnv('EMERGENCY_READ_ONLY', 'false')
  vi.clearAllMocks()
})
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })

it('logs failed storage cleanup without SDK request headers, filenames or exception text', async () => {
  const id = '11111111-2222-4333-8444-555555555555'
  const path = 'private-folder/confidential-document.pdf'
  mocks.query.mockResolvedValueOnce({ rows: [{ id, storage_path: path }] }).mockResolvedValueOnce({ rows: [] })
  mocks.deleteObject.mockRejectedValue(new Error('SDK request Authorization: Bearer sensitive-test-token'))
  const log = vi.spyOn(console, 'error').mockImplementation(() => {})
  await expect(documentsRouter.createCaller({}).delete({ id })).resolves.toBeUndefined()
  expect(mocks.deleteObject).toHaveBeenCalledWith(path)
  expect(log).toHaveBeenCalledOnce()
  expect(JSON.stringify(log.mock.calls)).not.toMatch(/Authorization|sensitive-test-token|private-folder|confidential-document/)
  expect(JSON.parse(String(log.mock.calls[0][0]))).toEqual({ event: 'security.document_cleanup_failed', documentId: id })
})
