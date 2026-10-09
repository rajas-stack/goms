import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { connectDrive, disconnectDrive, getDriveSession, getFolder, listFiles, trashFile, uploadFile } from './googleDrive'
import { getGoogleSession, saveGoogleSession, setGoogleAccount } from '@/features/integrations/session'

const scope = 'https://www.googleapis.com/auth/drive'
const fetchMock = vi.fn()
const initTokenClient = vi.fn()
const clientId = '456-entered-in-ui.apps.googleusercontent.com'

async function connected() {
  fetchMock.mockResolvedValueOnce(Response.json({ user: { emailAddress: 'admin@example.com' } }))
  await connectDrive(clientId)
}

describe('Google Drive integration', () => {
  beforeEach(() => {
    setGoogleAccount(null)
    disconnectDrive()
    vi.clearAllMocks()
    vi.stubGlobal('fetch', fetchMock)
    initTokenClient.mockImplementation((config) => ({ requestAccessToken: () => config.callback({ access_token: 'memory-only-token', expires_in: 3600, scope }) }))
    vi.stubGlobal('window', { google: { accounts: { oauth2: { initTokenClient } } } })
  })
  afterEach(() => { disconnectDrive(); disconnectDrive('sales'); disconnectDrive('bids'); vi.unstubAllGlobals(); vi.useRealTimers() })

  it('uses the client ID supplied by the UI and fetches the connected account', async () => {
    await connected()
    expect(initTokenClient.mock.calls[0][0].client_id).toBe(clientId)
    expect(getDriveSession()?.email).toBe('admin@example.com')
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer memory-only-token')
  })

  it('shares the verified integration grant, respects DMS disconnect and clears rejected tokens', async () => {
    setGoogleAccount({ uid: 'shared-user', email: 'user@amnex.com', googleId: 'google-user' })
    const grant = { uid: 'shared-user', email: 'user@amnex.com', accessToken: 'shared-first', scopes: [scope], expiresAt: Date.now() + 3600000, clientId }
    saveGoogleSession(grant)
    expect(getDriveSession('shared-dms')?.email).toBe('user@amnex.com')
    disconnectDrive('shared-dms')
    expect(getDriveSession('shared-dms')).toBeNull()
    expect(getGoogleSession([scope])).not.toBeNull()
    saveGoogleSession({ ...grant, accessToken: 'shared-new' })
    expect(getDriveSession('shared-dms')?.accessToken).toBe('shared-new')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Expired' } }, { status: 401 }))
    await expect(listFiles('folder', 'shared-dms')).rejects.toThrow('expired')
    expect(getGoogleSession([scope])).toBeNull()
    setGoogleAccount(null)
  })

  it('handles cancelled popups and missing Drive permissions without creating a session', async () => {
    initTokenClient.mockImplementation((config) => ({ requestAccessToken: () => config.error_callback({ type: 'popup_closed' }) }))
    await expect(connectDrive(clientId)).rejects.toThrow('cancelled')
    initTokenClient.mockImplementation((config) => ({ requestAccessToken: () => config.callback({ access_token: 'token', scope: 'openid' }) }))
    await expect(connectDrive(clientId)).rejects.toThrow('permission')
    expect(getDriveSession()).toBeNull()
  })

  it('loads every page of the chosen folder and supports shared drives', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(Response.json({ files: [{ id: 'first', name: 'A.pdf' }], nextPageToken: 'next' }))
    fetchMock.mockResolvedValueOnce(Response.json({ files: [{ id: 'second', name: 'B.pdf' }] }))
    expect(await listFiles('folder-id')).toHaveLength(2)
    const url = new URL(fetchMock.mock.calls[1][0])
    expect(url.searchParams.get('q')).toBe("'folder-id' in parents and trashed = false")
    expect(url.searchParams.get('includeItemsFromAllDrives')).toBe('true')
    expect(new URL(fetchMock.mock.calls[2][0]).searchParams.get('pageToken')).toBe('next')
  })

  it('rejects a file or trashed folder as the DMS root', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'file', mimeType: 'application/pdf' }))
    await expect(getFolder('file')).rejects.toThrow('existing Google Drive folder')
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'folder', mimeType: 'application/vnd.google-apps.folder', trashed: true }))
    await expect(getFolder('folder')).rejects.toThrow('existing Google Drive folder')
  })

  it('clears expired credentials on a 401 response', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Invalid credentials' } }, { status: 401 }))
    await expect(listFiles('folder')).rejects.toThrow('expired')
    expect(getDriveSession()).toBeNull()
  })

  it('moves files to trash with PATCH instead of permanently deleting them', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'document' }))
    await trashFile('document')
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ trashed: true })
  })

  it('uploads a new version to the existing file, preserving its name and parent', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(new Response(null, { headers: { Location: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=session' } }))
    fetchMock.mockResolvedValueOnce(Response.json({ id: 'existing', name: 'contract.pdf' }))
    const file = new File(['updated contents'], 'replacement.pdf', { type: 'application/pdf' })
    await uploadFile(file, 'root', 'Contracts', 'existing')
    expect(fetchMock.mock.calls[1][0]).toContain('/files/existing?uploadType=resumable')
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ appProperties: { category: 'Contracts' } })
    expect(fetchMock.mock.calls[2][1].method).toBe('PUT')
    expect(fetchMock.mock.calls[2][1].body).toBe(file)
  })

  it('never sends a token to an unexpected upload destination', async () => {
    await connected()
    fetchMock.mockResolvedValueOnce(new Response(null, { headers: { Location: 'https://unexpected.example.com/upload' } }))
    await expect(uploadFile(new File(['x'], 'file.pdf'), 'root', 'General')).rejects.toThrow('valid upload session')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })
  it('keeps independently connected DMS sessions and expires only the affected account', async () => {
    initTokenClient.mockImplementation((config) => ({ requestAccessToken: () => config.callback({ access_token: config.client_id, expires_in: 3600, scope }) }))
    fetchMock.mockResolvedValueOnce(Response.json({ user: { emailAddress: 'sales@example.com' } }))
    await connectDrive('123-sales.apps.googleusercontent.com', 'sales')
    fetchMock.mockResolvedValueOnce(Response.json({ user: { emailAddress: 'bids@example.com' } }))
    await connectDrive('456-bids.apps.googleusercontent.com', 'bids')
    fetchMock.mockResolvedValueOnce(Response.json({ error: { message: 'Expired' } }, { status: 401 }))
    await expect(listFiles('sales-root', 'sales')).rejects.toThrow('expired')
    expect(getDriveSession('sales')).toBeNull()
    expect(getDriveSession('bids')?.email).toBe('bids@example.com')
    fetchMock.mockResolvedValueOnce(Response.json({ files: [] }))
    await listFiles('bids-root', 'bids')
    expect(new Headers(fetchMock.mock.calls[3][1].headers).get('Authorization')).toBe('Bearer 456-bids.apps.googleusercontent.com')
  })
})
