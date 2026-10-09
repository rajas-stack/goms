import { beforeEach, describe, expect, it, vi } from 'vitest'

const db = vi.hoisted(() => ({ query: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
import { tenderWebsitesRouter } from './tenderWebsites.js'

const id = '00000000-0000-4000-8000-000000000001'
const row = (name: string, url: string) => ({ id, name, url, created_at: new Date('2026-10-01T00:00:00Z'), updated_at: new Date('2026-10-02T00:00:00Z') })
const caller = () => tenderWebsitesRouter.createCaller({ user: { email: 'editor@amnex.com', isAmnexAccount: true, emailVerified: true } } as any)

describe('tender websites router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.query.mockImplementation(async (sql: string, params?: unknown[]) => {
      if (sql.startsWith('SELECT * FROM tender_websites')) return { rows: [row('E-Proc', 'https://eproc.example.gov.in')] }
      if (sql.startsWith('INSERT INTO tender_websites') || sql.startsWith('UPDATE tender_websites')) return { rows: [row(params![0] as string, params![1] as string)] }
      return { rows: [] }
    })
  })

  it('lists websites in API shape', async () => {
    expect(await caller().list()).toEqual([{ id, name: 'E-Proc', url: 'https://eproc.example.gov.in', createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-02T00:00:00.000Z' }])
  })

  it('creates a website with a trimmed name and records the creator', async () => {
    const saved = await caller().create({ name: '  E-Proc ', url: ' https://eproc.example.gov.in ' })
    expect(saved).toMatchObject({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })
    const insert = db.query.mock.calls.find(call => String(call[0]).startsWith('INSERT INTO tender_websites'))!
    expect(insert[1]).toEqual(['E-Proc', 'https://eproc.example.gov.in', 'editor@amnex.com', null, null, 'tender'])
  })

  it('lists only the requested kind, defaulting to tender portals', async () => {
    await caller().list()
    expect(db.query).toHaveBeenLastCalledWith('SELECT * FROM tender_websites WHERE kind=$1 ORDER BY lower(name)', ['tender'])
    db.query.mockResolvedValueOnce({ rows: [{ ...row('GST', 'https://services.gst.gov.in'), kind: 'verification' }] })
    expect(await caller().list({ kind: 'verification' })).toEqual([expect.objectContaining({ kind: 'verification', name: 'GST' })])
    expect(db.query).toHaveBeenLastCalledWith('SELECT * FROM tender_websites WHERE kind=$1 ORDER BY lower(name)', ['verification'])
    await expect(caller().list({ kind: 'other' as never })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('creates a document verification site with its kind', async () => {
    await caller().create({ kind: 'verification', name: 'MCA', url: 'https://www.mca.gov.in' })
    const insert = db.query.mock.calls.find(call => String(call[0]).startsWith('INSERT INTO tender_websites'))!
    expect(insert[1]).toEqual(['MCA', 'https://www.mca.gov.in', 'editor@amnex.com', null, null, 'verification'])
    await expect(caller().create({ kind: 'bogus' as never, name: 'X', url: 'https://x.example' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects non-http links and blank names before touching the database', async () => {
    await expect(caller().create({ name: 'Bad', url: 'javascript:alert(1)' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().create({ name: 'Bad', url: 'ftp://files.example.com' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().create({ name: '   ', url: 'https://ok.example.com' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.query).not.toHaveBeenCalled()
  })

  it('maps a duplicate name to CONFLICT', async () => {
    db.query.mockRejectedValueOnce(Object.assign(new Error('dup'), { code: '23505' }))
    await expect(caller().create({ name: 'E-Proc', url: 'https://eproc.example.gov.in' })).rejects.toMatchObject({ code: 'CONFLICT' })
  })

  it('updates and reports a missing website as NOT_FOUND', async () => {
    expect(await caller().update({ id, name: 'GeM', url: 'https://gem.gov.in' })).toMatchObject({ name: 'GeM', url: 'https://gem.gov.in' })
    db.query.mockResolvedValueOnce({ rows: [] })
    await expect(caller().update({ id, name: 'GeM', url: 'https://gem.gov.in' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })

  it('deletes by id and validates the id', async () => {
    db.query.mockResolvedValueOnce({ rows: [{ id }] })
    await caller().delete({ id })
    expect(db.query).toHaveBeenCalledWith('DELETE FROM tender_websites WHERE id=$1 AND NOT editing_locked RETURNING id', [id])
    await expect(caller().delete({ id: 'nope' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })
  it('rejects direct deletion of a locked website without writing an audit success', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ editing_locked: true }] })
    await expect(caller().delete({ id })).rejects.toMatchObject({ code: 'CONFLICT' })
    expect(db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO commercial_audit_logs'))).toBe(false)
  })

  it('stores only the encrypted credential envelope and excludes it from audit values', async () => {
    const credentials = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    await caller().create({ name: 'Portal', url: 'https://portal.example', credentials })
    const insert = db.query.mock.calls.find(call => String(call[0]).startsWith('INSERT INTO tender_websites'))!
    expect(insert[1][3]).toEqual(credentials)
    const audit = db.query.mock.calls.find(call => String(call[0]).includes('INSERT INTO commercial_audit_logs'))!
    expect(JSON.stringify(audit[1])).not.toContain(credentials.ciphertext)
    await expect(caller().create({ name: 'Bad', url: 'https://portal.example', credentials: { ...credentials, salt: 'plaintext' } })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('rejects DSC assignees outside the active L0-L2 directory', async () => {
    const junior = '00000000-0000-4000-8000-000000000002'
    await expect(caller().create({ name: 'Portal', url: 'https://portal.example', dscEmployeeId: junior })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.query).toHaveBeenCalledWith("SELECT id FROM org_people WHERE id=$1 AND status='active' AND level IN (0,1,2)", [junior])
    expect(db.query.mock.calls.some(call => String(call[0]).startsWith('INSERT INTO tender_websites'))).toBe(false)
  })

  it('atomically rejects updates to an edit-locked website', async () => {
    db.query.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ editing_locked: true }] })
    await expect(caller().update({ id, name: 'Changed', url: 'https://changed.example' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'Unlock editing before changing this website.' })
    expect(db.query.mock.calls[0][0]).toContain('AND NOT editing_locked')
    expect(db.query.mock.calls.some(call => String(call[0]).includes('INSERT INTO commercial_audit_logs'))).toBe(false)
  })

  it('persists the edit lock separately and preserves the encrypted credentials', async () => {
    const credentials = { version: 1 as const, salt: 'AAAAAAAAAAAAAAAAAAAAAA==', iv: 'AAAAAAAAAAAAAAAA', ciphertext: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' }
    db.query.mockResolvedValueOnce({ rows: [{ ...row('Portal', 'https://portal.example'), editing_locked: true, credentials }] })
    expect(await caller().setEditingLock({ id, locked: true })).toMatchObject({ editingLocked: true, credentials })
    expect(db.query).toHaveBeenCalledWith('UPDATE tender_websites SET editing_locked=$1, updated_at=now() WHERE id=$2 RETURNING *', [true, id])
    db.query.mockResolvedValueOnce({ rows: [] })
    await expect(caller().setEditingLock({ id, locked: false })).rejects.toMatchObject({ code: 'NOT_FOUND' })
  })
})
