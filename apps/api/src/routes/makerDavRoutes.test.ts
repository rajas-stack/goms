import Fastify from 'fastify'
import cors from '@fastify/cors'
import { describe, expect, it } from 'vitest'
import { blankOfficeFile, makerDocumentKey, type MakerDocument, type MakerPermission } from '@goms/domain'
import { registerMakerDavRoutes, type DavStore } from './makerDavRoutes.js'

const id = '11111111-2222-4333-8444-555555555555'
const SESSION = 'AbCdEfGhIjKlMnOpQrStUv'
const base = `/api/dav/${SESSION}`

function setup(permissions?: MakerPermission[], email = 'writer@amnex.com') {
  let version = 1
  let bytes: Uint8Array = blankOfficeFile('docx')
  const doc = (): MakerDocument => ({
    id, kind: 'document', title: 'Plan', fileType: 'docx', size: bytes.length, version, documentKey: makerDocumentKey(id, version),
    ownerEmail: 'boss@amnex.com', ownerName: 'boss', createdAt: '2026-10-28T00:00:00.000Z', updatedAt: '2026-10-28T00:00:00.000Z',
    ...(permissions ? { permissions } : {}),
  })
  const saves: { by: string | null; size: number }[] = []
  let revoked = false
  const store: DavStore = {
    findSession: async (s) => (s === SESSION ? { documentId: id, email } : null),
    getAccessible: async () => (revoked ? null : doc()),
    readContent: async () => ({ doc: doc(), bytes }),
    saveVersion: async (_id, next, by) => { bytes = next; version += 1; saves.push({ by, size: next.length }); return doc() },
  }
  const app = Fastify()
  app.register(cors, { origin: ['http://localhost:8088'] }) // as in app.ts: strict preflight for browsers
  registerMakerDavRoutes(app, store)
  return { app, saves, revoke: () => { revoked = true } }
}

describe('WebDAV for Office apps', () => {
  it('answers the OPTIONS probe from Office instead of the CORS 400, with and without a trailing slash', async () => {
    const { app } = setup()
    for (const url of [base, `${base}/`, `${base}/Plan.docx`]) {
      const res = await app.inject({ method: 'OPTIONS', url })
      expect(res.statusCode, url).toBe(200)
      expect(res.headers.dav, url).toBe('1, 2')
    }
    expect((await app.inject({ method: 'PROPFIND', url: base, headers: { depth: '0' } })).body).toContain('<D:collection/>')
  })
  it('serves the file and its properties to an Office app', async () => {
    const { app } = setup()
    expect((await app.inject({ method: 'OPTIONS', url: `${base}/Plan.docx` })).headers.dav).toBe('1, 2')
    const props = await app.inject({ method: 'PROPFIND', url: `${base}/Plan.docx`, headers: { depth: '0' } })
    expect(props.statusCode).toBe(207)
    expect(props.body).toContain(`<D:getetag>"${id}-v1"</D:getetag>`)
    const folder = await app.inject({ method: 'PROPFIND', url: `${base}/`, headers: { depth: '1' } })
    expect(folder.body).toContain('<D:collection/>')
    expect(folder.body).toContain('Plan.docx')
    const get = await app.inject({ method: 'GET', url: `${base}/Plan.docx` })
    expect(get.statusCode).toBe(200)
    expect(get.rawPayload.subarray(0, 2).toString()).toBe('PK')
  })

  it('locks, saves every PUT as a version, and unlocks on close', async () => {
    const { app, saves } = setup(['write'])
    const lock = await app.inject({ method: 'LOCK', url: `${base}/Plan.docx`, payload: '<lockinfo/>', headers: { 'content-type': 'text/xml' } })
    expect(lock.statusCode).toBe(200)
    const token = String(lock.headers['lock-token'])
    expect(token).toMatch(/^<opaquelocktoken:/)
    const file = Buffer.from(blankOfficeFile('docx'))
    const put = await app.inject({ method: 'PUT', url: `${base}/Plan.docx`, payload: file, headers: { 'content-type': 'application/octet-stream', if: `(${token})` } })
    expect(put.statusCode).toBe(204)
    expect(saves).toEqual([{ by: 'writer@amnex.com', size: file.length }])
    expect((await app.inject({ method: 'UNLOCK', url: `${base}/Plan.docx`, headers: { 'lock-token': token } })).statusCode).toBe(204)
  })

  it('opens read-only for read-only shares and refuses their saves', async () => {
    const { app, saves } = setup(['read'])
    expect((await app.inject({ method: 'LOCK', url: `${base}/Plan.docx` })).statusCode).toBe(403)
    const put = await app.inject({ method: 'PUT', url: `${base}/Plan.docx`, payload: Buffer.from(blankOfficeFile('docx')), headers: { 'content-type': 'application/octet-stream' } })
    expect(put.statusCode).toBe(403)
    expect(saves).toEqual([])
  })

  it('rejects unknown sessions, revoked access and non-Office content', async () => {
    const { app, saves, revoke } = setup()
    expect((await app.inject({ method: 'GET', url: '/api/dav/ZZZZZZZZZZZZZZZZZZZZZZ/Plan.docx' })).statusCode).toBe(404)
    expect((await app.inject({ method: 'GET', url: '/api/dav/short/Plan.docx' })).statusCode).toBe(404)
    const html = await app.inject({ method: 'PUT', url: `${base}/Plan.docx`, payload: '<html>', headers: { 'content-type': 'text/html' } })
    expect(html.statusCode).toBe(415)
    revoke()
    expect((await app.inject({ method: 'GET', url: `${base}/Plan.docx` })).statusCode).toBe(404)
    expect(saves).toEqual([])
  })
})
