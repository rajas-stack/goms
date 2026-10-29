import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { SignJWT } from 'jose'
import { blankOfficeFile, makerDocumentKey, type MakerDocument } from '@goms/domain'
vi.mock('../db.js', () => ({ pool: {} }))
import { signDownloadToken } from '../lib/makerDownloadToken.js'
import { registerDocumentMakerRoutes } from './documentMakerRoutes.js'

const SECRET = 'route-test-session-secret-0123456789abcdef'
const id = '11111111-2222-4333-8444-555555555555'
const docx = blankOfficeFile('docx')
const old = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 1])

function setup() {
  const doc: MakerDocument = {
    id, kind: 'document', title: 'Plan', fileType: 'docx', size: docx.length, version: 3, documentKey: makerDocumentKey(id, 3),
    ownerEmail: 'a@amnex.com', ownerName: 'a', createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
  }
  const app = Fastify()
  registerDocumentMakerRoutes(app, {
    readContent: async (wanted) => (wanted === id ? { doc, bytes: docx } : null),
    readVersionContent: async (_id, version) => (version === 2 ? old : null),
  })
  return app
}
const get = (token: string, docId = id) => setup().inject({ method: 'GET', url: `/api/document-maker/files/${docId}?token=${encodeURIComponent(token)}` })

describe('Document maker download link', () => {
  beforeEach(() => { process.env.AUTH_SESSION_SECRET = SECRET })
  afterEach(() => { delete process.env.AUTH_SESSION_SECRET })

  it('downloads the current version, or an earlier one named in the token', async () => {
    const current = await get(await signDownloadToken({ id }))
    expect(current.statusCode).toBe(200)
    expect(current.headers['content-disposition']).toContain('filename="Plan.docx"')
    expect(current.rawPayload.length).toBe(docx.length)
    const earlier = await get(await signDownloadToken({ id, version: 2 }))
    expect(earlier.headers['content-disposition']).toContain('filename="Plan (v2).docx"')
    expect([...earlier.rawPayload]).toEqual([...old])
    expect((await get(await signDownloadToken({ id, version: 1 }))).statusCode).toBe(404)
  })

  it('refuses missing, foreign-document, forged and sign-in tokens', async () => {
    expect((await setup().inject({ method: 'GET', url: `/api/document-maker/files/${id}` })).statusCode).toBe(403)
    expect((await get(await signDownloadToken({ id: '99999999-2222-4333-8444-555555555555' }))).statusCode).toBe(403)
    const forged = await new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).setAudience('goms:maker-download').sign(new TextEncoder().encode('x'.repeat(40)))
    expect((await get(forged)).statusCode).toBe(403)
    // A token signed with the raw session key (as sign-in tokens are) is not a download token.
    const session = await new SignJWT({ id }).setProtectedHeader({ alg: 'HS256' }).sign(new TextEncoder().encode(SECRET))
    expect((await get(session)).statusCode).toBe(403)
  })
})
