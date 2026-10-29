import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankOfficeFile } from '@goms/domain'

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
vi.mock('../auth/identity.js', async (original) => ({
  ...(await original<typeof import('../auth/identity.js')>()),
  verifyIdentity: vi.fn(async () => ({ uid: 'u1', email: 'Writer@amnex.com' })),
}))
import { makerDocumentsRouter } from './makerDocuments.js'

const ENV = { AUTH_SESSION_SECRET: 'router-test-session-secret-0123456789abcdef' }
const id = '11111111-2222-4333-8444-555555555555'
const row = (over: Record<string, unknown> = {}) => ({
  id, kind: 'document', title: 'Plan', file_type: 'docx', size_bytes: 100, version: 1, document_key: `${id}-v1`,
  owner_email: 'writer@amnex.com', owner_name: 'writer', created_at: new Date('2026-10-12'), updated_at: new Date('2026-10-12'), ...over,
})
const caller = () => makerDocumentsRouter.createCaller({ authHeader: 'Bearer t' } as any)
const sql = () => db.query.mock.calls.map((call) => String(call[0]))

describe('makerDocuments router', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    db.connect.mockResolvedValue({ query: db.query, release: db.release })
    db.query.mockImplementation(async (text: string, params?: unknown[]) => {
      if (text.includes('INSERT INTO maker_documents')) return { rows: [row({ id: params![0], kind: params![1], title: params![2], file_type: params![3], size_bytes: params![5], document_key: params![6] })] }
      if (text.startsWith('SELECT') && text.includes('FROM maker_documents')) return { rows: [row({ content: Buffer.from(blankOfficeFile('docx')) })] }
      return { rows: [] }
    })
    Object.assign(process.env, ENV)
  })
  afterEach(() => { for (const name of Object.keys(ENV)) delete process.env[name] })

  it('lists only the caller\'s files, without their bytes', async () => {
    await caller().list()
    const [text, params] = db.query.mock.calls[0]
    expect(text).toContain('d.owner_email=$1 OR s.grantee_email IS NOT NULL')
    expect(text).toContain('s.grantee_email=$1')
    expect(text).not.toMatch(/\bcontent\b/)
    expect(params).toEqual(['writer@amnex.com'])
  })

  it('creates a blank Office file of the right type with an audit row', async () => {
    const created = await caller().create({ kind: 'spreadsheet', title: '  Budget  ' })
    expect(created).toMatchObject({ kind: 'spreadsheet', fileType: 'xlsx', title: 'Budget', version: 1 })
    const insert = db.query.mock.calls.find((call) => String(call[0]).includes('INSERT INTO maker_documents'))!
    expect((insert[1] as unknown[])[4]).toBeInstanceOf(Buffer)
    expect(((insert[1] as unknown[])[4] as Buffer).subarray(0, 2).toString()).toBe('PK')
    expect(sql()).toEqual(expect.arrayContaining(['BEGIN', 'COMMIT']))
    expect(sql().some((text) => text.includes('commercial_audit_logs'))).toBe(true)
  })

  it('validates kind and title before touching the database', async () => {
    await expect(caller().create({ kind: 'macro' as any, title: 'x' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().create({ kind: 'document', title: '   ' })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    expect(db.connect).not.toHaveBeenCalled()
  })

  it('accepts uploads only for Office extensions with zip content', async () => {
    const data = Buffer.from(blankOfficeFile('pptx')).toString('base64')
    expect(await caller().upload({ name: 'Deck.pptx', data })).toMatchObject({ kind: 'presentation', fileType: 'pptx', title: 'Deck' })
    await expect(caller().upload({ name: 'Deck.exe', data })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
    await expect(caller().upload({ name: 'Deck.pptx', data: Buffer.from('<html>').toString('base64') })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
  })

  it('scopes rename, duplicate and delete to the owner and reports missing files', async () => {
    db.query.mockImplementation(async () => ({ rows: [] }))
    await expect(caller().rename({ id, title: 'New' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller().duplicate({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    await expect(caller().delete({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    for (const call of db.query.mock.calls.filter((c) => /maker_documents/.test(String(c[0])))) {
      expect(String(call[0])).toMatch(/owner_email=\$2|d\.owner_email=\$1 OR s\.grantee_email IS NOT NULL/)
      expect(call[1]).toEqual(expect.arrayContaining([id, 'writer@amnex.com']))
    }
  })

  describe('sharing', () => {
    const shared = (flags: Record<string, boolean>) => row({ owner_email: 'boss@amnex.com', shared: true, can_read: false, can_comment: false, can_write: false, ...flags })
    const serve = (doc: Record<string, unknown>, employee: Record<string, unknown> | null = { name: 'Asha', email: 'asha@amnex.com' }) =>
      db.query.mockImplementation(async (text: string) => {
        if (text.includes('FROM employees')) return { rows: employee ? [employee] : [] }
        if (text.includes('FROM maker_document_shares WHERE')) return { rows: [] }
        if (text.includes('FROM maker_documents')) return { rows: [{ ...doc, content: Buffer.from(blankOfficeFile('docx')) }] }
        return { rows: [], rowCount: 0 }
      })

    it('grants any combination of permissions to an Amnex employee from the directory', async () => {
      serve(row())
      await caller().share({ id, email: ' Asha@AMNEX.com ', permissions: ['write', 'read', 'write'] })
      const insert = db.query.mock.calls.find((c) => String(c[0]).includes('INSERT INTO maker_document_shares'))!
      expect(insert[1]).toEqual([id, 'asha@amnex.com', 'Asha', true, false, true, 'writer@amnex.com'])
    })

    it('refuses outsiders, people missing from the directory and non-owners', async () => {
      serve(row())
      await expect(caller().share({ id, email: 'x@gmail.com', permissions: ['read'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(caller().share({ id, email: 'writer@amnex.com', permissions: ['read'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      await expect(caller().share({ id, email: 'asha@amnex.com', permissions: [] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      serve(row(), null)
      await expect(caller().share({ id, email: 'ghost@amnex.com', permissions: ['read'] })).rejects.toMatchObject({ code: 'BAD_REQUEST' })
      db.query.mockImplementation(async () => ({ rows: [] }))
      await expect(caller().share({ id, email: 'asha@amnex.com', permissions: ['read'] })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      expect(db.query.mock.calls.some((c) => String(c[0]).includes('INSERT INTO maker_document_shares'))).toBe(false)
    })

    it('enforces each shared permission', async () => {
      const data = Buffer.from(blankOfficeFile('docx')).toString('base64')
      serve(shared({ can_read: true }))
      expect((await caller().downloadUrl({ id })).path).toContain(id)
      expect((await caller().desktopSession({ id })).write).toBe(false)
      await expect(caller().replace({ id, name: 'Plan.docx', data })).rejects.toMatchObject({ code: 'FORBIDDEN' })

      // Comments are written into the file by Word, so a comment share saves like a write share.
      serve(shared({ can_comment: true }))
      await expect(caller().downloadUrl({ id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      await expect(caller().duplicate({ id })).rejects.toMatchObject({ code: 'FORBIDDEN' })
      expect((await caller().desktopSession({ id })).write).toBe(true)

      serve(shared({ can_write: true }))
      expect((await caller().desktopSession({ id })).write).toBe(true)
    })

    it('lets only the owner rename, delete or manage shares', async () => {
      db.query.mockImplementation(async (text: string) => ({ rows: text.includes('owner_email=$2') ? [] : [shared({ can_write: true })] }))
      await expect(caller().rename({ id, title: 'X' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(caller().shares({ id })).rejects.toMatchObject({ code: 'NOT_FOUND' })
      await expect(caller().unshare({ id, email: 'asha@amnex.com' })).rejects.toMatchObject({ code: 'NOT_FOUND' })
    })
  })

  it('duplicates the bytes under a "Copy of" title', async () => {
    const copy = await caller().duplicate({ id })
    expect(copy.title).toBe('Copy of Plan')
    expect(copy.id).not.toBe(id)
  })

  it('issues a short download link', async () => {
    const { path } = await caller().downloadUrl({ id })
    expect(path).toMatch(new RegExp(`^/api/document-maker/files/${id}\\?token=`))
  })
})
