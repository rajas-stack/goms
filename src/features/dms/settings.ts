export interface DmsSettings {
  provider: 'google-drive' | 'external'
  externalUrl: string
  clientId: string
  rootFolderId: string
  maxUploadMb: number | null
  allowedFiles: 'documents' | 'all' | 'pdf'
  autoRefresh: boolean
}

export const DMS_SETTINGS_KEY = 'goms.dms.settings.v1'
export const DEFAULT_DMS_SETTINGS: DmsSettings = {
  provider: 'google-drive',
  externalUrl: '',
  clientId: '',
  rootFolderId: '',
  maxUploadMb: 50,
  allowedFiles: 'documents',
  autoRefresh: true,
}

export function folderIdFromInput(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return ''
  if (/^[\w-]+$/.test(trimmed)) return trimmed
  try {
    const url = new URL(trimmed)
    if (url.hostname !== 'drive.google.com') throw new Error()
    const id = url.pathname.match(/\/folders\/([\w-]+)/)?.[1] ?? url.searchParams.get('id')
    if (id && /^[\w-]+$/.test(id)) return id
  } catch { /* Show the same validation message for malformed URLs. */ }
  throw new Error('Enter a Google Drive folder URL or folder ID.')
}

export function validateSettings(settings: DmsSettings): DmsSettings {
  if (!['google-drive', 'external'].includes(settings.provider)) throw new Error('Choose a storage provider.')
  const externalUrl = settings.externalUrl.trim()
  if (externalUrl) {
    try { if (new URL(externalUrl).protocol !== 'https:') throw new Error() }
    catch { throw new Error('Enter a valid HTTPS URL for your external DMS.') }
  }
  if (settings.provider === 'external' && !externalUrl) throw new Error('Enter your external DMS URL.')
  const clientId = settings.clientId.trim()
  if (clientId && !/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) {
    throw new Error('Enter a valid Google OAuth web client ID.')
  }
  if (settings.maxUploadMb !== null && (!Number.isInteger(settings.maxUploadMb) || settings.maxUploadMb < 1)) {
    throw new Error('Enter a positive whole number for the upload limit, or leave it blank for no limit.')
  }
  if (!['documents', 'all', 'pdf'].includes(settings.allowedFiles)) throw new Error('Choose an allowed file type.')
  return {
    provider: settings.provider, externalUrl, clientId,
    rootFolderId: folderIdFromInput(settings.rootFolderId),
    maxUploadMb: settings.maxUploadMb, allowedFiles: settings.allowedFiles,
    autoRefresh: Boolean(settings.autoRefresh),
  }
}

export function loadSettings(): DmsSettings {
  try {
    const saved = localStorage.getItem(DMS_SETTINGS_KEY)
    return saved ? validateSettings({ ...DEFAULT_DMS_SETTINGS, ...JSON.parse(saved) }) : { ...DEFAULT_DMS_SETTINGS }
  } catch { return { ...DEFAULT_DMS_SETTINGS } }
}

export function saveSettings(settings: DmsSettings): DmsSettings {
  const valid = validateSettings(settings)
  localStorage.setItem(DMS_SETTINGS_KEY, JSON.stringify(valid))
  return valid
}

const DOCUMENT_EXTENSIONS = /\.(pdf|docx?|xlsx?|pptx?|odt|ods|odp|txt|csv|rtf|png|jpe?g|webp|gif)$/i
export function validateUpload(file: Pick<File, 'name' | 'size'>, settings: DmsSettings): void {
  if (!file.size) throw new Error(`${file.name} is empty.`)
  if (settings.maxUploadMb !== null && file.size > settings.maxUploadMb * 1024 * 1024) throw new Error(`${file.name} exceeds the ${settings.maxUploadMb} MB limit.`)
  if (settings.allowedFiles === 'pdf' && !/\.pdf$/i.test(file.name)) throw new Error('Only PDF files are allowed.')
  if (settings.allowedFiles === 'documents' && !DOCUMENT_EXTENSIONS.test(file.name)) throw new Error(`${file.name} is not a supported document or image.`)
}

export function formatBytes(bytes: number): string {
  if (!bytes) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}
