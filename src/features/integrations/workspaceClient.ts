import type { GoogleService } from '@goms/domain'
import { authorizeGoogle, googleApiRequest, googleFeatureToken } from './googleClient'
import { productFor } from './catalog'
import { assertGoogleAccount, getGoogleAccount } from './session'
import { googleServiceEnabled, googleSettings } from './settings'

export type WorkspaceAction = 'load' | 'create' | 'read' | 'append' | 'messages' | 'translate' | 'upload'
export interface WorkspaceItem { id: string; title: string; detail?: string }
export interface WorkspaceResult { items?: WorkspaceItem[]; text?: string; rows?: string[][]; message?: string; resourceId?: string; meetingUrl?: string }
export interface ActionField { key: string; label: string; type?: 'textarea' | 'datetime-local' | 'email'; required?: boolean }
export interface ActionDefinition { id: WorkspaceAction; label: string; fields: ActionField[]; scopes?: string[] }
const scope = (value: string) => `https://www.googleapis.com/auth/${value}`
const title: ActionField = { key: 'title', label: 'Title', required: true }
const body: ActionField = { key: 'text', label: 'Text', type: 'textarea', required: true }
const resource: ActionField = { key: 'resource', label: 'Resource ID', required: true }
const load: ActionDefinition = { id: 'load', label: 'Load recent items', fields: [] }
export const WORKSPACE_ACTIONS: Partial<Record<GoogleService, ActionDefinition[]>> = {
  gmail: [load, { id: 'create', label: 'Send email', scopes: [scope('gmail.send')], fields: [{ key: 'to', label: 'To', type: 'email', required: true }, { ...title, label: 'Subject' }, { ...body, label: 'Message' }] }],
  drive: [load, { id: 'create', label: 'Create folder', fields: [title] }, { id: 'upload', label: 'Upload file', fields: [] }],
  docs: [load, { id: 'read', label: 'Read document', fields: [resource] }, { id: 'create', label: 'Create document', scopes: [scope('documents')], fields: [title, body] }],
  sheets: [load, { id: 'read', label: 'Read cells', fields: [resource, { key: 'range', label: 'Range (e.g. A1:F20)', required: true }] }, { id: 'create', label: 'Create spreadsheet', scopes: [scope('spreadsheets')], fields: [title] }, { id: 'append', label: 'Append rows', scopes: [scope('spreadsheets')], fields: [resource, { key: 'range', label: 'Range (e.g. Sheet1!A1)', required: true }, { ...body, label: 'Rows (tab-separated columns)' }] }],
  calendar: [load, { id: 'create', label: 'Create event', scopes: [scope('calendar.events')], fields: [title, { key: 'start', label: 'Starts', type: 'datetime-local', required: true }, { key: 'end', label: 'Ends', type: 'datetime-local', required: true }, { key: 'location', label: 'Location' }, { ...body, label: 'Description', required: false }] }],
  chat: [load, { id: 'messages', label: 'Read messages', scopes: [scope('chat.messages.readonly')], fields: [{ ...resource, label: 'Space (spaces/...)' }] }, { id: 'create', label: 'Send message', scopes: [scope('chat.messages.create')], fields: [{ ...resource, label: 'Space (spaces/...)' }, { ...body, label: 'Message' }] }],
  meet: [load, { id: 'create', label: 'Create meeting', scopes: [scope('meetings.space.created')], fields: [] }],
  keep: [load, { id: 'create', label: 'Create note', scopes: [scope('keep')], fields: [title, body] }],
  tasks: [load, { id: 'read', label: 'Load tasks', fields: [{ ...resource, label: 'Task list ID' }] }, { id: 'create', label: 'Create task', scopes: [scope('tasks')], fields: [{ ...resource, label: 'Task list ID' }, title, { ...body, label: 'Notes', required: false }] }],
  translate: [{ id: 'translate', label: 'Translate text', fields: [body, { key: 'target', label: 'Target language code (e.g. hi)', required: true }] }],
  notebooklm: [load, { id: 'read', label: 'Read notebook', fields: [resource] }, { id: 'create', label: 'Create notebook', fields: [title] }],
  sites: [load],
}

/** Fixed API operations, never an arbitrary destination; all results are account-bound. */
export async function runWorkspaceAction(service: GoogleService, action: WorkspaceAction, fields: Record<string, string> = {}, file?: File, pageId = 'integrations', connectionTest = false): Promise<WorkspaceResult> {
  if (connectionTest && !['load', 'read', 'messages', 'translate'].includes(action)) throw new Error('Connection tests cannot change Google data.')
  const definition = WORKSPACE_ACTIONS[service]?.find(item => item.id === action)
  if (!definition) throw new Error('This action is unavailable for this service.')
  for (const field of definition.fields) if (field.required && !fields[field.key]?.trim()) throw new Error(`${field.label} is required.`)
  if (Object.values(fields).some(value => value.length > 100_000)) throw new Error('Text must be under 100,000 characters.')
  const account = getGoogleAccount()
  if (!account) throw new Error('Sign in with your verified Amnex Google account.')
  const settings = googleSettings(account)
  if (['translate', 'notebooklm'].includes(service) && !settings.cloudProject) throw new Error('Save your Google Cloud project in Connection setup.')
  if (service === 'notebooklm' && !['global', 'us', 'eu'].includes(settings.notebookLocation)) throw new Error('Choose a valid NotebookLM location.')
  if (service === 'gmail' && action === 'create' && (!/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(fields.to) || /[\r\n]/.test(fields.title))) throw new Error('Enter one valid recipient and a single-line subject.')
  if (service === 'calendar' && action === 'create' && (!Number.isFinite(Date.parse(fields.start)) || !Number.isFinite(Date.parse(fields.end)) || Date.parse(fields.end) <= Date.parse(fields.start))) throw new Error('The event must end after it starts.')
  if (service === 'chat' && action !== 'load' && !/^spaces\/[A-Za-z0-9_-]+$/.test(fields.resource)) throw new Error('Choose a valid Chat space.')
  if (action === 'upload' && (!file || file.size > 25 * 1024 * 1024)) throw new Error('Choose a file up to 25 MB.')
  const token = connectionTest ? await authorizeGoogle(account, [...productFor(service).scopes, ...(definition.scopes ?? [])], settings.clientId) : await googleFeatureToken(service, pageId, definition.scopes)
  assertGoogleAccount(account)
  const request = async <T>(url: string, payload?: unknown): Promise<T> => {
    assertGoogleAccount(account)
    if (!connectionTest && !googleServiceEnabled(service, pageId)) throw new Error('This service was disabled on this page. Enable it before retrying.')
    const value = await googleApiRequest<T>(url, token, ['translate', 'notebooklm'].includes(service) ? settings.cloudProject : undefined, payload === undefined ? {} : { method: 'POST', body: payload })
    assertGoogleAccount(account)
    if (!connectionTest && !googleServiceEnabled(service, pageId)) throw new Error('This service was disabled on this page.')
    return value
  }
  const id = encodeURIComponent(fields.resource ?? '')
  if (service === 'drive' || service === 'docs' && action === 'load' || service === 'sheets' && action === 'load' || service === 'sites') {
    const base = 'https://www.googleapis.com/drive/v3/files'
    if (action === 'create') {
      const result = await request<{ id: string }>(base, { name: fields.title, mimeType: 'application/vnd.google-apps.folder' })
      return { message: 'Folder created in your Drive.', resourceId: result.id }
    }
    if (action === 'upload') {
      const boundary = `goms_${crypto.randomUUID()}`
      const form = new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({ name: file!.name })}\r\n--${boundary}\r\nContent-Type: application/octet-stream\r\n\r\n`, file!, `\r\n--${boundary}--\r\n`], { type: `multipart/related; boundary=${boundary}` })
      const result = await request<{ id: string }>('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', form)
      return { message: 'File uploaded to your Drive.', resourceId: result.id }
    }
    const mime = service === 'docs' ? 'application/vnd.google-apps.document' : service === 'sheets' ? 'application/vnd.google-apps.spreadsheet' : service === 'sites' ? 'application/vnd.google-apps.site' : null
    const params = new URLSearchParams({ q: `trashed=false${mime ? ` and mimeType='${mime}'` : ''}`, pageSize: '20', orderBy: 'modifiedTime desc', fields: 'files(id,name,mimeType,modifiedTime)' })
    const data = await request<{ files?: { id: string; name: string; mimeType: string }[] }>(`${base}?${params}`)
    return { items: (data.files ?? []).map(item => ({ id: item.id, title: item.name, detail: item.mimeType })), message: service === 'sites' ? 'Sites listed from Drive. Google does not provide a modern Sites page-editing API.' : undefined }
  }
  if (service === 'gmail') {
    const base = 'https://gmail.googleapis.com/gmail/v1/users/me/messages'
    if (action === 'create') {
      const subject = `=?UTF-8?B?${base64Utf8(fields.title)}?=`
      const encodedBody = base64Utf8(fields.text).match(/.{1,76}/g)?.join('\r\n') ?? ''
      const raw = base64Utf8(`To: ${fields.to}\r\nSubject: ${subject}\r\nMIME-Version: 1.0\r\nContent-Type: text/plain; charset=UTF-8\r\nContent-Transfer-Encoding: base64\r\n\r\n${encodedBody}`).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
      const result = await request<{ id: string }>(`${base}/send`, { raw })
      return { message: 'Email sent.', resourceId: result.id }
    }
    const list = await request<{ messages?: { id: string }[] }>(`${base}?maxResults=10`)
    const items = await Promise.all((list.messages ?? []).map(async item => {
      const message = await request<{ payload?: { headers?: { name: string; value: string }[] } }>(`${base}/${encodeURIComponent(item.id)}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`)
      const header = (name: string) => message.payload?.headers?.find(h => h.name.toLowerCase() === name)?.value ?? ''
      return { id: item.id, title: header('subject') || '(No subject)', detail: `${header('from')} · ${header('date')}` }
    }))
    return { items }
  }
  if (service === 'docs') {
    const base = 'https://docs.googleapis.com/v1/documents'
    if (action === 'read') {
      const doc = await request<{ title: string; body?: { content?: DocElement[] }; tabs?: { documentTab?: { body?: { content?: DocElement[] } }; childTabs?: DocTab[] }[] }>(`${base}/${id}?includeTabsContent=true`)
      return { text: `${doc.title}\n\n${doc.body ? docText(doc.body.content ?? []) : tabText(doc.tabs ?? [])}` }
    }
    const doc = await request<{ documentId: string }>(base, { title: fields.title })
    try { await request(`${base}/${encodeURIComponent(doc.documentId)}:batchUpdate`, { requests: [{ insertText: { endOfSegmentLocation: {}, text: fields.text } }] }) }
    catch (error) { throw new Error(`Document ${doc.documentId} was created, but adding its text failed. ${error instanceof Error ? error.message : ''}`) }
    return { message: 'Document created with your text.', resourceId: doc.documentId }
  }
  if (service === 'sheets') {
    const base = 'https://sheets.googleapis.com/v4/spreadsheets'
    if (action === 'create') {
      const result = await request<{ spreadsheetId: string }>(base, { properties: { title: fields.title } })
      return { message: 'Spreadsheet created.', resourceId: result.spreadsheetId }
    }
    const range = encodeURIComponent(fields.range)
    if (action === 'read') {
      const result = await request<{ values?: unknown[][] }>(`${base}/${id}/values/${range}`)
      return { rows: (result.values ?? []).map(row => row.map(String)) }
    }
    // RAW keeps user input literal rather than executing spreadsheet formulas.
    const result = await request<{ updates?: { updatedRows?: number } }>(`${base}/${id}/values/${range}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, { values: fields.text.split(/\r?\n/).filter(Boolean).map(line => line.split('\t')) })
    return { message: `${result.updates?.updatedRows ?? 0} rows appended.` }
  }
  if (service === 'calendar') {
    const base = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
    if (action === 'create') {
      const result = await request<{ id: string }>(base, { summary: fields.title, description: fields.text ?? '', location: fields.location ?? '', start: { dateTime: new Date(fields.start).toISOString() }, end: { dateTime: new Date(fields.end).toISOString() } })
      return { message: 'Event added to your primary calendar.', resourceId: result.id }
    }
    const params = new URLSearchParams({ timeMin: new Date().toISOString(), singleEvents: 'true', orderBy: 'startTime', maxResults: '20' })
    const data = await request<{ items?: { id: string; summary?: string; start?: { dateTime?: string; date?: string }; location?: string }[] }>(`${base}?${params}`)
    return { items: (data.items ?? []).map(event => ({ id: event.id, title: event.summary ?? '(Untitled event)', detail: `${event.start?.dateTime ?? event.start?.date ?? ''} ${event.location ?? ''}` })) }
  }
  if (service === 'chat') {
    const base = 'https://chat.googleapis.com/v1'
    if (action === 'create') { const result = await request<{ name: string }>(`${base}/${fields.resource}/messages`, { text: fields.text }); return { message: 'Message sent.', resourceId: result.name } }
    if (action === 'messages') { const data = await request<{ messages?: { name: string; text?: string; createTime?: string }[] }>(`${base}/${fields.resource}/messages?pageSize=20&orderBy=createTime%20desc`); return { items: (data.messages ?? []).map(item => ({ id: item.name, title: item.text ?? '(Attachment or card)', detail: item.createTime })) } }
    const data = await request<{ spaces?: { name: string; displayName?: string; spaceType?: string }[] }>(`${base}/spaces?pageSize=20`)
    return { items: (data.spaces ?? []).map(item => ({ id: item.name, title: item.displayName ?? item.name, detail: item.spaceType })) }
  }
  if (service === 'meet') {
    if (action === 'create') { const data = await request<{ name: string; meetingUri: string }>('https://meet.googleapis.com/v2/spaces', {}); return { message: 'Meeting created.', resourceId: data.name, meetingUrl: data.meetingUri } }
    const data = await request<{ conferenceRecords?: { name: string; startTime?: string; endTime?: string }[] }>('https://meet.googleapis.com/v2/conferenceRecords?pageSize=20')
    return { items: (data.conferenceRecords ?? []).map(item => ({ id: item.name, title: item.name, detail: `${item.startTime ?? ''} ${item.endTime ?? ''}` })) }
  }
  if (service === 'tasks') {
    const base = 'https://tasks.googleapis.com/tasks/v1'
    if (action === 'create') { const data = await request<{ id: string }>(`${base}/lists/${id}/tasks`, { title: fields.title, notes: fields.text ?? '' }); return { message: 'Task created.', resourceId: data.id } }
    if (action === 'read') { const data = await request<{ items?: { id: string; title: string; notes?: string; status: string }[] }>(`${base}/lists/${id}/tasks?maxResults=20`); return { items: (data.items ?? []).map(item => ({ id: item.id, title: item.title, detail: `${item.status} ${item.notes ?? ''}` })) } }
    const data = await request<{ items?: { id: string; title: string }[] }>(`${base}/users/@me/lists?maxResults=20`)
    return { items: data.items ?? [], message: 'Select a task list to load or create tasks.' }
  }
  if (service === 'keep') {
    const base = 'https://keep.googleapis.com/v1/notes'
    if (action === 'create') { const data = await request<{ name: string }>(base, { title: fields.title, body: { text: { text: fields.text } } }); return { message: 'Note created.', resourceId: data.name } }
    const data = await request<{ notes?: { name: string; title?: string; body?: { text?: { text?: string } } }[] }>(`${base}?pageSize=20`)
    return { items: (data.notes ?? []).map(item => ({ id: item.name, title: item.title ?? '(Untitled)', detail: item.body?.text?.text })) }
  }
  if (service === 'translate') {
    if (!/^[a-z]{2,3}(?:-[A-Za-z]{2,4})?$/.test(fields.target)) throw new Error('Enter a valid target language code.')
    const data = await request<{ data: { translations: { translatedText: string; detectedSourceLanguage?: string }[] } }>('https://translation.googleapis.com/language/translate/v2', { q: fields.text, target: fields.target, format: 'text' })
    return { text: data.data.translations.map(item => item.translatedText).join('\n') }
  }
  const base = `https://${settings.notebookLocation}-discoveryengine.googleapis.com/v1alpha/projects/${encodeURIComponent(settings.cloudProject)}/locations/${settings.notebookLocation}/notebooks`
  if (action === 'create') { const data = await request<{ name: string }>(base, { title: fields.title }); return { message: 'Notebook created.', resourceId: data.name.split('/').pop() } }
  if (action === 'read') { const data = await request<{ title: string; sources?: { title?: string; name?: string }[] }>(`${base}/${id}`); return { text: `${data.title}\n${(data.sources ?? []).map(source => source.title ?? source.name).join('\n')}` } }
  const data = await request<{ notebooks?: { notebookId: string; title: string }[] }>(`${base}:listRecentlyViewed?pageSize=20`)
  return { items: (data.notebooks ?? []).map(item => ({ id: item.notebookId, title: item.title })) }
}

function base64Utf8(value: string) { return btoa(Array.from(new TextEncoder().encode(value), byte => String.fromCharCode(byte)).join('')) }
interface DocElement { paragraph?: { elements?: { textRun?: { content?: string } }[] }; table?: { tableRows?: { tableCells?: { content?: DocElement[] }[] }[] } }
interface DocTab { documentTab?: { body?: { content?: DocElement[] } }; childTabs?: DocTab[] }
function docText(elements: DocElement[]): string { return elements.map(element => element.paragraph?.elements?.map(run => run.textRun?.content ?? '').join('') ?? element.table?.tableRows?.map(row => row.tableCells?.map(cell => docText(cell.content ?? [])).join('\t')).join('\n') ?? '').join('') }
function tabText(tabs: DocTab[]): string { return tabs.map(tab => docText(tab.documentTab?.body?.content ?? []) + tabText(tab.childTabs ?? [])).join('\n') }
