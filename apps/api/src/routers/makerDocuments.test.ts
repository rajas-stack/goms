import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { blankOfficeFile } from '@goms/domain'

const db = vi.hoisted(() => ({ query: vi.fn(), connect: vi.fn(), release: vi.fn() }))
vi.mock('../db.js', () => ({ pool: db }))
vi.mock('../auth/identity.js', async (original) => ({
  ...(await original<typeof import('../auth/identity.js')>()),
  verifyIdentity: vi.fn(async () => ({ uid: 'u1', email: 'Writer@amnex.com' })),
}))
import { makerDocumentsRouter } from './makerDocuments.js'
import { verifyToken, onlyofficeSettings } from '../lib/onlyoffice.js'

const ENV = { ONLYOFFICE_JWT_SECRET: 'router-test-secret-long-enough-0123456789', ONLYOFFICE_URL: 'http://localhost:8082', ONLYOFFICE_INTERNAL_API_URL: 'http://host.docker.internal:8787' }
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
    expect(text).toContain('WHERE owner_email=$1')
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
      expect(String(call[0])).toContain('owner_email=$2')
      expect(call[1]).toEqual(expect.arrayContaining([id, 'writer@amnex.com']))
    }
  })

  it('duplicates the bytes under a "Copy of" title', async () => {
    const copy = await caller().duplicate({ id })
    expect(copy.title).toBe('Copy of Plan')
    expect(copy.id).not.toBe(id)
  })

  it('returns a signed editor config and refuses when ONLYOFFICE is not configured', async () => {
    const { config, documentServerUrl } = await caller().editorConfig({ id, theme: 'dark' })
    expect(documentServerUrl).toBe('http://localhost:8082')
    expect(config.documentType).toBe('word')
    expect(config.editorConfig.user).toEqual({ id: 'writer@amnex.com', name: 'writer' })
    expect(await verifyToken(config.token, onlyofficeSettings().secret)).not.toBeNull()
    delete process.env.ONLYOFFICE_JWT_SECRET
    await expect(caller().editorConfig({ id, theme: 'light' })).rejects.toMatchObject({ code: 'PRECONDITION_FAILED' })
  })

  it('issues a short download link', async () => {
    const { path } = await caller().downloadUrl({ id })
    expect(path).toMatch(new RegExp(`^/api/document-maker/files/${id}\\?token=`))
  })
})
