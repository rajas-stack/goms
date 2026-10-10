import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_GOOGLE_INTEGRATIONS } from '@goms/domain'
import { authorizeGoogle, googleFeatureToken } from './googleClient'
import { runWorkspaceAction } from './workspaceClient'
import { setGoogleAccount } from './session'
import { saveGoogleSettings } from './settings'
vi.mock('./googleClient', async importOriginal => ({ ...await importOriginal<typeof import('./googleClient')>(), authorizeGoogle: vi.fn(async () => 'in-memory-token'), googleFeatureToken: vi.fn(async () => 'in-memory-token') }))
const fetchMock = vi.fn()
const account = { uid: 'workspace-tests', email: 'a@amnex.com', googleId: 'google-a' }
beforeEach(async () => {
  vi.clearAllMocks(); setGoogleAccount(account)
  vi.stubGlobal('localStorage', { getItem: vi.fn(() => null), setItem: vi.fn() })
  await saveGoogleSettings(account, { ...DEFAULT_GOOGLE_INTEGRATIONS, clientId: '123.apps.googleusercontent.com', cloudProject: '123456', notebookLocation: 'global' })
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockImplementation(async () => Response.json({}))
})
afterEach(() => { setGoogleAccount(null); vi.unstubAllGlobals() })
describe('Google Workspace API actions', () => {
  it('loads Gmail headers from the Gmail API rather than navigating away', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ messages: [{ id: 'message-a' }] })).mockResolvedValueOnce(Response.json({ payload: { headers: [{ name: 'Subject', value: 'Tender update' }, { name: 'From', value: 'user@amnex.com' }] } }))
    expect(await runWorkspaceAction('gmail', 'load')).toMatchObject({ items: [{ id: 'message-a', title: 'Tender update' }] })
    expect(fetchMock.mock.calls[0][0]).toContain('gmail.googleapis.com/gmail/v1/users/me/messages')
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer in-memory-token')
  })
  it('creates and populates a real Google Doc with incremental write consent', async () => {
    fetchMock.mockResolvedValueOnce(Response.json({ documentId: 'new-doc' })).mockResolvedValueOnce(Response.json({}))
    expect(await runWorkspaceAction('docs', 'create', { title: 'Bid notes', text: 'Hello' })).toMatchObject({ resourceId: 'new-doc' })
    expect(googleFeatureToken).toHaveBeenCalledWith('docs', 'integrations', ['https://www.googleapis.com/auth/documents'])
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ method: 'POST', body: JSON.stringify({ title: 'Bid notes' }), redirect: 'error' })
    expect(fetchMock.mock.calls[1][0]).toContain('/new-doc:batchUpdate')
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).requests[0].insertText.text).toBe('Hello')
  })
  it('reads document tabs and nested table text without rendering HTML', async () => {
    fetchMock.mockResolvedValue(Response.json({ title: 'Doc', tabs: [{ documentTab: { body: { content: [{ paragraph: { elements: [{ textRun: { content: '<b>Plain text</b>' } }] } }] } } }] }))
    expect(await runWorkspaceAction('docs', 'read', { resource: 'doc-a' })).toMatchObject({ text: 'Doc\n\n<b>Plain text</b>' })
  })
  it('appends spreadsheet rows as literal RAW values', async () => {
    fetchMock.mockResolvedValue(Response.json({ updates: { updatedRows: 2 } }))
    expect(await runWorkspaceAction('sheets', 'append', { resource: 'sheet-a', range: 'Sheet1!A1', text: '=1+1\tAmnex\n2\tBid' })).toMatchObject({ message: '2 rows appended.' })
    expect(fetchMock.mock.calls[0][0]).toContain('valueInputOption=RAW')
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ values: [['=1+1', 'Amnex'], ['2', 'Bid']] })
  })
  it('validates mail headers and event times before requesting consent', async () => {
    await expect(runWorkspaceAction('gmail', 'create', { to: 'user@amnex.com', title: 'Hi\r\nBcc: bad@example.com', text: 'Body' })).rejects.toThrow('single-line subject')
    await expect(runWorkspaceAction('calendar', 'create', { title: 'Bid', start: '2026-10-15T12:00', end: '2026-10-15T11:00' })).rejects.toThrow('end after')
    expect(googleFeatureToken).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('sends UTF-8 email through Gmail messages.send', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'sent-a' }))
    expect(await runWorkspaceAction('gmail', 'create', { to: 'user@amnex.com', title: 'बोली', text: 'Bid details' })).toMatchObject({ message: 'Email sent.' })
    const raw = JSON.parse(fetchMock.mock.calls[0][1].body).raw
    const decoded = Buffer.from(raw, 'base64url').toString('utf8')
    expect(decoded).toContain('To: user@amnex.com\r\nSubject: =?UTF-8?B?')
    expect(decoded).toContain(Buffer.from('Bid details').toString('base64'))
    expect(fetchMock.mock.calls[0][0]).toContain('/messages/send')
  })
  it.each([
    ['calendar', { title: 'Event', start: '2026-10-15T10:00', end: '2026-10-15T11:00' }, 'calendar/v3/calendars/primary/events'],
    ['chat', { resource: 'spaces/space-a', text: 'Update' }, '/v1/spaces/space-a/messages'],
    ['tasks', { resource: 'list-a', title: 'Submit bid' }, '/lists/list-a/tasks'],
    ['keep', { title: 'Note', text: 'Remember' }, '/v1/notes'],
    ['meet', {}, '/v2/spaces'],
    ['notebooklm', { title: 'Bid research' }, 'projects/123456/locations/global/notebooks'],
  ] as const)('writes %s using its actual API', async (service, fields, path) => {
    fetchMock.mockResolvedValue(Response.json({ id: 'new-a', name: 'resource/new-a', meetingUri: 'https://meet.google.com/abc-defg-hij' }))
    await runWorkspaceAction(service, 'create', fields)
    expect(fetchMock.mock.calls[0][0]).toContain(path)
    expect(fetchMock.mock.calls[0][1].method).toBe('POST')
  })
  it('uploads Drive files with the required multipart/related format', async () => {
    fetchMock.mockResolvedValue(Response.json({ id: 'uploaded-a' }))
    await runWorkspaceAction('drive', 'upload', {}, new File(['contents'], 'bid.txt'))
    const options = fetchMock.mock.calls[0][1]
    expect(options.headers['Content-Type']).toContain('multipart/related; boundary=goms_')
    expect(await options.body.text()).toContain('"name":"bid.txt"')
    expect(fetchMock.mock.calls[0][0]).toContain('uploadType=multipart')
  })
  it('discards responses if the signed-in account changes during a request', async () => {
    fetchMock.mockImplementation(async () => { setGoogleAccount({ uid: 'b', email: 'b@amnex.com', googleId: 'b' }); return Response.json({ files: [{ id: 'private-a', name: 'Private' }] }) })
    await expect(runWorkspaceAction('drive', 'load')).rejects.toThrow('account changed')
  })
  it('reports API errors without fake success or retrying a write', async () => {
    fetchMock.mockResolvedValue(Response.json({ error: { message: 'API is disabled' } }, { status: 403 }))
    await expect(runWorkspaceAction('drive', 'create', { title: 'Folder' })).rejects.toThrow('API is disabled')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
  it('translates text using Cloud Translation and the billing project', async () => {
    fetchMock.mockResolvedValue(Response.json({ data: { translations: [{ translatedText: 'नमस्ते' }] } }))
    expect(await runWorkspaceAction('translate', 'translate', { text: 'Hello', target: 'hi' })).toMatchObject({ text: 'नमस्ते' })
    expect(fetchMock.mock.calls[0][0]).toBe('https://translation.googleapis.com/language/translate/v2')
    expect(fetchMock.mock.calls[0][1].headers['x-goog-user-project']).toBe('123456')
  })
  it('stops requests when a page is disabled while consent is pending', async () => {
    vi.mocked(googleFeatureToken).mockImplementationOnce(async () => { await saveGoogleSettings(account, { ...DEFAULT_GOOGLE_INTEGRATIONS, disabledPages: { drive: ['integrations'] } }); return 'token' })
    await expect(runWorkspaceAction('drive', 'create', { title: 'Folder' })).rejects.toThrow('disabled on this page')
    expect(fetchMock).not.toHaveBeenCalled()
  })
  it('permits read-only diagnostics of an inactive service but never writes through test mode', async () => {
    await saveGoogleSettings(account, { ...DEFAULT_GOOGLE_INTEGRATIONS, disabledServices: ['drive'], clientId: '123.apps.googleusercontent.com' })
    await runWorkspaceAction('drive', 'load', {}, undefined, 'integrations', true)
    expect(authorizeGoogle).toHaveBeenCalled()
    expect(fetchMock).toHaveBeenCalledOnce()
    await expect(runWorkspaceAction('drive', 'create', { title: 'Folder' }, undefined, 'integrations', true)).rejects.toThrow('cannot change Google data')
    expect(fetchMock).toHaveBeenCalledOnce()
  })
})
