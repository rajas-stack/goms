import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import Fastify from 'fastify'
import { blankOfficeFile, makerDocumentKey, type MakerDocument } from '@goms/domain'
vi.mock('../db.js', () => ({ pool: {} }))
import { onlyofficeSettings, signToken, urlToken } from '../lib/onlyoffice.js'
import { CallbackRejected, handleCallback, registerDocumentMakerRoutes, type MakerFileStore } from './documentMakerRoutes.js'

const ENV = { ONLYOFFICE_JWT_SECRET: 'route-test-secret-long-enough-0123456789', ONLYOFFICE_URL: 'http://localhost:8082', ONLYOFFICE_INTERNAL_API_URL: 'http://host.docker.internal:8787' }
const settings = onlyofficeSettings(ENV)
const id = '11111111-2222-4333-8444-555555555555'
const docx = blankOfficeFile('docx')

function makeStore(version = 1) {
  let doc: MakerDocument = {
    id, kind: 'document', title: 'Plan', fileType: 'docx', size: docx.length, version, documentKey: makerDocumentKey(id, version),
    ownerEmail: 'a@amnex.com', ownerName: 'a', createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
  }
  const store = {
    readContent: vi.fn(async (wanted: string) => (wanted === id ? { doc, bytes: docx } : null)),
    readVersionContent: vi.fn(async () => null as Uint8Array | null),
    saveVersion: vi.fn(async (_id: string, bytes: Uint8Array) => {
      doc = { ...doc, version: doc.version + 1, documentKey: makerDocumentKey(id, doc.version + 1), size: bytes.length }
      return doc
    }),
    current: () => doc,
  }
  return store
}

const fileFetch = (bytes: Uint8Array = docx) => vi.fn(async () => new Response(bytes)) as unknown as typeof fetch

async function callback(body: Record<string, unknown>, opts: { store?: ReturnType<typeof makeStore>; fetchImpl?: typeof fetch; queryToken?: string; asHeader?: boolean } = {}) {
  const store = opts.store ?? makeStore()
  const token = await signToken(body, settings.secret)
  const input = {
    id, queryToken: opts.queryToken ?? await urlToken('callback', { id }, settings.secret),
    body: opts.asHeader ? body : { ...body, token },
    authorization: opts.asHeader ? `Bearer ${await signToken({ payload: body }, settings.secret)}` : undefined,
  }
  return { result: await handleCallback(input, { settings, store, fetchImpl: opts.fetchImpl ?? fileFetch() }), store }
}

describe('ONLYOFFICE callback', () => {
  const key = makerDocumentKey(id, 1)
  const url = 'http://localhost:8082/cache/files/data/output.docx'

  it.each([1, 4])('acknowledges status %i without saving', async (status) => {
    const { result, store } = await callback({ key, status })
    expect(result).toEqual({ error: 0 })
    expect(store.saveVersion).not.toHaveBeenCalled()
  })

  it.each([2, 6])('status %i downloads the file and stores a new version with a new key', async (status) => {
    const fetchImpl = fileFetch()
    const { result, store } = await callback({ key, status, url, filetype: 'docx', users: ['a@amnex.com'] }, { fetchImpl })
    expect(result).toEqual({ error: 0 })
    expect(store.saveVersion).toHaveBeenCalledOnce()
    expect(store.current().version).toBe(2)
    expect(store.current().documentKey).not.toBe(key)
    expect(String((fetchImpl as any).mock.calls[0][0])).toBe(url)
  })

  it('accepts the token in the Authorization header', async () => {
    const { result } = await callback({ key, status: 2, url }, { asHeader: true })
    expect(result).toEqual({ error: 0 })
  })

  it('accepts a session that started on an earlier version', async () => {
    const store = makeStore(3)
    const { result } = await callback({ key: makerDocumentKey(id, 2), status: 2, url }, { store })
    expect(result).toEqual({ error: 0 })
  })

  it('rejects unsigned, forged and foreign callbacks', async () => {
    const store = makeStore()
    const queryToken = await urlToken('callback', { id }, settings.secret)
    await expect(handleCallback({ id, queryToken, body: { key, status: 2, url }, authorization: undefined }, { settings, store })).rejects.toBeInstanceOf(CallbackRejected)
    await expect(handleCallback({ id, queryToken, body: { key, status: 2, url, token: 'forged' }, authorization: undefined }, { settings, store })).rejects.toBeInstanceOf(CallbackRejected)
    await expect(callback({ key, status: 2, url }, { queryToken: await urlToken('download', { id }, settings.secret) })).rejects.toBeInstanceOf(CallbackRejected)
    await expect(callback({ key: makerDocumentKey('99999999-2222-4333-8444-555555555555', 1), status: 2, url })).rejects.toBeInstanceOf(CallbackRejected)
    expect(store.saveVersion).not.toHaveBeenCalled()
  })

  it('refuses to download from any host but the Document Server', async () => {
    const fetchImpl = fileFetch()
    await expect(callback({ key, status: 2, url: 'http://169.254.169.254/latest/meta-data' }, { fetchImpl })).rejects.toThrow('not on the Document Server')
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('does not store a non-Office payload or a different file type', async () => {
    expect((await callback({ key, status: 2, url }, { fetchImpl: fileFetch(new TextEncoder().encode('<html>')) })).result).toEqual({ error: 1 })
    expect((await callback({ key, status: 2, url, filetype: 'xlsx' })).result).toEqual({ error: 1 })
  })
})

describe('HTTP routes', () => {
  beforeEach(() => { Object.assign(process.env, ENV) })
  afterEach(() => { for (const name of Object.keys(ENV)) delete process.env[name] })

  async function app(store: MakerFileStore) {
    const instance = Fastify()
    registerDocumentMakerRoutes(instance, store)
    await instance.ready()
    return instance
  }

  it('serves the exact version to the Document Server and a download to the browser', async () => {
    const store = makeStore()
    const server = await app(store)
    const fileToken = await urlToken('file', { id, key: makerDocumentKey(id, 1) }, settings.secret)
    const file = await server.inject({ url: `/api/document-maker/files/${id}?token=${encodeURIComponent(fileToken)}` })
    expect(file.statusCode).toBe(200)
    expect(file.headers['content-type']).toContain('wordprocessingml')
    expect(file.rawPayload.subarray(0, 2).toString()).toBe('PK')
    const stale = await urlToken('file', { id, key: makerDocumentKey(id, 0 + 9) }, settings.secret)
    expect((await server.inject({ url: `/api/document-maker/files/${id}?token=${encodeURIComponent(stale)}` })).statusCode).toBe(409)
    const download = await urlToken('download', { id }, settings.secret)
    const res = await server.inject({ url: `/api/document-maker/files/${id}?token=${encodeURIComponent(download)}` })
    expect(res.headers['content-disposition']).toContain('Plan.docx')
  })

  it('refuses missing, wrong-purpose and forged tokens', async () => {
    const server = await app(makeStore())
    expect((await server.inject({ url: `/api/document-maker/files/${id}` })).statusCode).toBe(403)
    const callbackToken = await urlToken('callback', { id }, settings.secret)
    expect((await server.inject({ url: `/api/document-maker/files/${id}?token=${callbackToken}` })).statusCode).toBe(403)
    const download = await urlToken('download', { id }, settings.secret)
    expect((await server.inject({ url: `/api/document-maker/files/${id}?token=${download}`, headers: { authorization: 'Bearer forged' } })).statusCode).toBe(403)
    const res = await server.inject({ method: 'POST', url: `/api/document-maker/callback/${id}?token=bad`, payload: { key: 'x', status: 2 } })
    expect(res.statusCode).toBe(403)
  })

  it('answers 503 when the editor is not configured', async () => {
    delete process.env.ONLYOFFICE_JWT_SECRET
    const server = await app(makeStore())
    expect((await server.inject({ url: `/api/document-maker/files/${id}?token=x` })).statusCode).toBe(503)
  })
})
