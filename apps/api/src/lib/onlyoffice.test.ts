import { describe, expect, it, vi } from 'vitest'
import { SignJWT } from 'jose'
import { makerDocumentKey, type MakerDocument } from '@goms/domain'
import {
  assertAllowedDownload, buildEditorConfig, downloadFile, internalFetchUrl, onlyofficeSettings, OnlyofficeNotConfigured, readUrlToken,
  signToken, urlToken, verifyToken,
} from './onlyoffice.js'

const SECRET = 'test-secret-that-is-long-enough-0123456789'
const ENV = { ONLYOFFICE_JWT_SECRET: SECRET, ONLYOFFICE_URL: 'http://localhost:8082/', ONLYOFFICE_INTERNAL_API_URL: 'http://host.docker.internal:8787' }
const settings = onlyofficeSettings(ENV)
const id = '11111111-2222-4333-8444-555555555555'
const doc = (fileType: MakerDocument['fileType'], version = 1): MakerDocument => ({
  id, kind: fileType === 'docx' ? 'document' : fileType === 'xlsx' ? 'spreadsheet' : 'presentation', title: 'Plan', fileType,
  size: 10, version, documentKey: makerDocumentKey(id, version), ownerEmail: 'a@amnex.com', ownerName: 'a',
  createdAt: '2026-10-12T00:00:00.000Z', updatedAt: '2026-10-12T00:00:00.000Z',
})

describe('settings', () => {
  it('fails fast without a strong secret or URLs', () => {
    expect(() => onlyofficeSettings({ ...ENV, ONLYOFFICE_JWT_SECRET: undefined })).toThrow(OnlyofficeNotConfigured)
    expect(() => onlyofficeSettings({ ...ENV, ONLYOFFICE_JWT_SECRET: 'short' })).toThrow('at least')
    expect(() => onlyofficeSettings({ ...ENV, ONLYOFFICE_URL: 'ftp://x' })).toThrow('http')
    expect(() => onlyofficeSettings({ ...ENV, ONLYOFFICE_INTERNAL_API_URL: undefined })).toThrow('ONLYOFFICE_INTERNAL_API_URL')
  })
  it('allows downloads only from the Document Server origins', () => {
    expect(settings.downloadOrigins).toEqual(['http://localhost:8082'])
    expect(onlyofficeSettings({ ...ENV, ONLYOFFICE_INTERNAL_URL: 'http://onlyoffice' }).downloadOrigins).toEqual(['http://localhost:8082', 'http://onlyoffice'])
  })
})

describe('JWT', () => {
  it('round-trips and rejects a token signed with another secret, expired, or not HS256', async () => {
    const token = await signToken({ a: 1 }, settings.secret, '1h')
    expect((await verifyToken(token, settings.secret))?.a).toBe(1)
    expect(await verifyToken(token, new TextEncoder().encode('x'.repeat(40)))).toBeNull()
    const expired = await new SignJWT({ a: 1 }).setProtectedHeader({ alg: 'HS256' }).setExpirationTime(1).sign(settings.secret)
    expect(await verifyToken(expired, settings.secret)).toBeNull()
    expect(await verifyToken('e30.e30.', settings.secret)).toBeNull()
    expect(await verifyToken(undefined, settings.secret)).toBeNull()
  })
  it('binds URL tokens to purpose and document', async () => {
    const token = await urlToken('download', { id }, settings.secret)
    expect(await readUrlToken(token, ['download'], id, settings.secret)).toMatchObject({ purpose: 'download', id })
    expect(await readUrlToken(token, ['callback'], id, settings.secret)).toBeNull()
    expect(await readUrlToken(token, ['download'], '99999999-2222-4333-8444-555555555555', settings.secret)).toBeNull()
  })
})

describe('editor config', () => {
  it.each([['docx', 'word'], ['xlsx', 'cell'], ['pptx', 'slide']] as const)('%s opens as %s', async (fileType, documentType) => {
    const { config, documentServerUrl } = await buildEditorConfig(doc(fileType), { id: 'a@amnex.com', name: 'a' }, 'light', settings)
    expect(documentServerUrl).toBe('http://localhost:8082')
    expect(config.documentType).toBe(documentType)
    expect(config.document).toMatchObject({ fileType, title: `Plan.${fileType}` })
    expect(config.document.url.startsWith(`http://host.docker.internal:8787/api/document-maker/files/${id}?token=`)).toBe(true)
    expect(config.editorConfig.callbackUrl.startsWith(`http://host.docker.internal:8787/api/document-maker/callback/${id}?token=`)).toBe(true)
    expect(config.editorConfig).toMatchObject({ lang: 'en', user: { id: 'a@amnex.com', name: 'a' }, customization: { uiTheme: 'theme-light' } })
  })
  it('signs the whole config and uses a new key per version', async () => {
    const v1 = (await buildEditorConfig(doc('docx', 1), { id: 'u', name: 'u' }, 'dark', settings)).config
    const v2 = (await buildEditorConfig(doc('docx', 2), { id: 'u', name: 'u' }, 'dark', settings)).config
    expect(v1.document.key).not.toBe(v2.document.key)
    expect(v1.editorConfig.customization.uiTheme).toBe('theme-dark')
    const { token, ...unsigned } = v1
    const payload = await verifyToken(token, settings.secret)
    expect(payload).toMatchObject(JSON.parse(JSON.stringify(unsigned)))
  })
})

describe('download guard', () => {
  it('rejects other hosts, schemes and credentials', () => {
    expect(assertAllowedDownload('http://localhost:8082/cache/files/x/output.docx', settings.downloadOrigins).pathname).toBe('/cache/files/x/output.docx')
    expect(() => assertAllowedDownload('http://169.254.169.254/latest', settings.downloadOrigins)).toThrow('not on the Document Server')
    expect(() => assertAllowedDownload('http://localhost:8083/x', settings.downloadOrigins)).toThrow()
    expect(() => assertAllowedDownload('file:///etc/passwd', settings.downloadOrigins)).toThrow()
    expect(() => assertAllowedDownload('http://u:p@localhost:8082/x', settings.downloadOrigins)).toThrow()
    expect(() => assertAllowedDownload(42, settings.downloadOrigins)).toThrow()
  })
  it('fetches browser-facing Document Server URLs through the internal URL when one is set', () => {
    const inCompose = onlyofficeSettings({ ...ENV, ONLYOFFICE_INTERNAL_URL: 'http://onlyoffice' })
    const url = new URL('http://localhost:8082/cache/files/k/output.docx?md5=x')
    expect(internalFetchUrl(url, inCompose).href).toBe('http://onlyoffice/cache/files/k/output.docx?md5=x')
    expect(internalFetchUrl(url, settings).href).toBe(url.href)
    expect(internalFetchUrl(new URL('http://onlyoffice/x'), inCompose).href).toBe('http://onlyoffice/x')
  })
  it.each(['//169.254.169.254/latest', '//other.example/output.docx', '/%2f%2fother.example/output.docx'])('keeps remapped downloads on the configured origin for %s', path => {
    const inCompose = onlyofficeSettings({ ...ENV, ONLYOFFICE_INTERNAL_URL: 'http://onlyoffice:8080' })
    const original = assertAllowedDownload(`http://localhost:8082${path}?md5=x`, inCompose.downloadOrigins)
    const mapped = internalFetchUrl(original, inCompose)
    expect(mapped.origin).toBe('http://onlyoffice:8080')
    expect(mapped.pathname).toBe(original.pathname)
    expect(mapped.search).toBe('?md5=x')
    expect(original.origin).toBe('http://localhost:8082')
  })
  it('caps the download size and refuses redirects', async () => {
    const fetchImpl = vi.fn(async () => new Response(new Uint8Array(20))) as unknown as typeof fetch
    await expect(downloadFile(new URL('http://localhost:8082/f'), 10, fetchImpl)).rejects.toThrow('too large')
    expect((fetchImpl as any).mock.calls[0][1]).toMatchObject({ redirect: 'error' })
    const ok = vi.fn(async () => new Response(new Uint8Array([1, 2, 3]))) as unknown as typeof fetch
    expect(await downloadFile(new URL('http://localhost:8082/f'), 10, ok)).toEqual(new Uint8Array([1, 2, 3]))
    const failed = vi.fn(async () => new Response('no', { status: 404 })) as unknown as typeof fetch
    await expect(downloadFile(new URL('http://localhost:8082/f'), 10, failed)).rejects.toThrow('404')
  })
})
