import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { bidSynopsisRouter } from './bidSynopsis.js'

const bidId = '00000000-0000-4000-8000-000000000001'
const document = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'User content' }] }] }
const caller = () => bidSynopsisRouter.createCaller({ user: { email: 'editor@amnex.com', isAmnexAccount: true, emailVerified: true } } as any)

describe('bid synopsis router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.connect.mockResolvedValue({ query: db.query, release: db.release })
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT id FROM bids')) return { rows: [{ id: bidId }] }
      if (sql.startsWith('SELECT * FROM bid_synopsis_sections')) return { rows: [] }
      if (sql.includes('INSERT INTO bid_synopsis_sections')) return { rows: [{ bid_id: params![0], section: params![1], document: JSON.parse(params![2] as string), revision: params![3], updated_at: new Date('2026-10-06T00:00:00Z'), updated_by: params![4] }] }
      return { rows: [] }
    })
  })

  it('returns null for an unsaved section', async () => {
    expect(await caller().get({ bidId, section: 'pq' })).toBeNull()
  })

  it('serializes first saves on the bid and writes revision and audit in one transaction', async () => {
    const saved = await caller().save({ bidId, section: 'pq', document, expectedRevision: 0 })
    expect(saved).toMatchObject({ bidId, section: 'pq', document, revision: 1, updatedBy: 'editor@amnex.com' })
    const sql = db.query.mock.calls.map(call => String(call[0]))
    expect(sql[0]).toBe('BEGIN')
    expect(sql[1]).toContain('FOR UPDATE')
    expect(sql.some(value => value.includes('INSERT INTO commercial_audit_logs'))).toBe(true)
    expect(sql.at(-1)).toBe('COMMIT')
    expect(db.release).toHaveBeenCalledOnce()
  })

  it('rejects stale revision writes and rolls back without changing a document', async () => {
    db.query.mockImplementation(async (sql: string) => ({ rows: sql.startsWith('SELECT id FROM bids') ? [{ id: bidId }] : sql.startsWith('SELECT * FROM bid_synopsis_sections') ? [{ revision: 2 }] : [] }))
    await expect(caller().save({ bidId, section: 'pq', document, expectedRevision: 1 })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.query).toHaveBeenCalledWith('ROLLBACK')
    expect(db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO bid_synopsis_sections'))).toBe(false)
    expect(db.release).toHaveBeenCalledOnce()
  })

  it('rejects missing bids and malformed content', async () => {
    db.query.mockResolvedValue({ rows: [] })
    await expect(caller().save({ bidId, section: 'pq', document, expectedRevision: 0 })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller().get({ bidId, section: 'pq' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller().save({ bidId, section: 'pq', document: { type: 'script' }, expectedRevision: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects unsupported sections and invalid revisions before touching the database', async () => {
    await expect(caller().save({ bidId, section: 'custom' as any, document, expectedRevision: 0 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().save({ bidId, section: 'pq', document, expectedRevision: -1 })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.connect).not.toHaveBeenCalled()
  })
})
