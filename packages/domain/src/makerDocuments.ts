/** Document maker: real Office files (.docx / .xlsx / .pptx) edited in the installed Word / Excel / PowerPoint.
 *  The bytes live server-side; this module holds the shared record shape and every rule both repositories enforce. */

export const MAKER_DOCUMENT_KINDS = ['document', 'spreadsheet', 'presentation'] as const
export type MakerDocumentKind = (typeof MAKER_DOCUMENT_KINDS)[number]

export const MAKER_FILE_TYPES = ['docx', 'xlsx', 'pptx'] as const
export type MakerFileType = (typeof MAKER_FILE_TYPES)[number]


export const FILE_TYPE_FOR_KIND: Record<MakerDocumentKind, MakerFileType> = {
  document: 'docx', spreadsheet: 'xlsx', presentation: 'pptx',
}
export const KIND_FOR_FILE_TYPE: Record<MakerFileType, MakerDocumentKind> = {
  docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation',
}
export const MIME_FOR_FILE_TYPE: Record<MakerFileType, string> = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
}
export const KIND_LABELS: Record<MakerDocumentKind, string> = {
  document: 'Document', spreadsheet: 'Spreadsheet', presentation: 'Presentation',
}

export const MAKER_LIMITS = {
  /** A version saved back from Word / Excel / PowerPoint. */
  fileBytes: 50 * 1024 * 1024,
  /** A file uploaded from the browser (sent base64 inside one API request, which is capped at 8 MB). */
  uploadBytes: 5 * 1024 * 1024,
  title: 200,
} as const

export interface MakerDocument {
  id: string
  kind: MakerDocumentKind
  title: string
  fileType: MakerFileType
  /** Bytes of the current version. */
  size: number
  /** Starts at 1; +1 for every version saved back from Office or replaced by an upload. */
  version: number
  /** A new value for every version; served as the WebDAV ETag so Office never reuses a stale copy. */
  documentKey: string
  ownerEmail: string
  ownerName: string
  createdAt: string
  updatedAt: string
  /** The caller's rights on a file shared with them; absent on the caller's own files (full access). */
  permissions?: MakerPermission[]
}

/** Independent rights a file owner grants (any combination). Every share may open the file; `read` adds
 *  download and copy, `comment` and `write` both let the person save changes from Word (comments live in the file). */
export const MAKER_PERMISSIONS = ['read', 'comment', 'write'] as const
export type MakerPermission = (typeof MAKER_PERMISSIONS)[number]

export interface MakerShare {
  email: string
  name: string
  permissions: MakerPermission[]
  sharedBy: string
  updatedAt: string
}

export interface MakerVersion {
  version: number
  size: number
  savedBy: string | null
  reason: string
  createdAt: string
}

/** Upload of an employee's own files to their Google Drive. */
export interface MakerDriveStatus { configured: boolean; connected: boolean; lastSyncAt: string | null; lastError: string | null; folderUrl: string | null }

/** The caller's rights on a file: everything for the owner, otherwise what was shared. */
export function makerRights(doc: Pick<MakerDocument, 'permissions'>): Record<MakerPermission, boolean> & { owner: boolean } {
  const granted = doc.permissions
  if (!granted) return { owner: true, read: true, comment: true, write: true }
  // Desktop Word stores comments inside the file, so commenting means saving it: comment implies write.
  return { owner: false, read: granted.includes('read'), comment: granted.includes('comment'), write: granted.includes('write') || granted.includes('comment') }
}

/** Sorted, de-duplicated, non-empty permission list, or an error message. */
export function normalizeMakerPermissions(raw: readonly unknown[]): MakerPermission[] {
  const set = MAKER_PERMISSIONS.filter((p) => raw.includes(p))
  if (!set.length) throw new Error('Choose at least one permission.')
  return set
}

/** Files are shared only with Amnex employees. */
export function isAmnexEmail(email: unknown): email is string {
  return typeof email === 'string' && /^[^@\s]+@amnex\.com$/i.test(email.trim())
}

/** Unique per document and version (`[0-9A-Za-z_-]`, at most 128 characters). */
export function makerDocumentKey(id: string, version: number): string {
  const safe = id.replace(/[^0-9A-Za-z_-]/g, '')
  if (!safe || !Number.isInteger(version) || version < 1) throw new Error('Invalid document version.')
  return `${safe}-v${version}`.slice(0, 128)
}

/** Trimmed title, or an error message. */
export function normalizeMakerTitle(raw: unknown): string {
  if (typeof raw !== 'string') throw new Error('Enter a name for the file.')
  // eslint-disable-next-line no-control-regex
  const title = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (!title) throw new Error('Enter a name for the file.')
  if (title.length > MAKER_LIMITS.title) throw new Error(`Keep the name under ${MAKER_LIMITS.title} characters.`)
  return title
}

export function isMakerKind(value: unknown): value is MakerDocumentKind {
  return typeof value === 'string' && (MAKER_DOCUMENT_KINDS as readonly string[]).includes(value)
}

/** The allowed Office type for a file name's extension, or null. */
export function fileTypeForName(name: string): MakerFileType | null {
  const ext = name.toLowerCase().match(/\.([a-z]+)$/)?.[1]
  return ext && (MAKER_FILE_TYPES as readonly string[]).includes(ext) ? (ext as MakerFileType) : null
}

/** File name without its Office extension, as a title. */
export function titleFromFileName(name: string): string {
  return name.replace(/\.(docx|xlsx|pptx)$/i, '').trim() || 'Untitled'
}

/** "Name.docx" for downloads; characters that break file names are replaced. */
export function downloadName(doc: Pick<MakerDocument, 'title' | 'fileType'>): string {
  const base = doc.title.replace(/[\\/:*?"<>|]+/g, '_').trim() || 'Untitled'
  return `${base}.${doc.fileType}`
}

/** OOXML files are zip archives: they start with the local file header "PK\x03\x04". */
export function hasZipMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04
}

/** Extension AND content checks for a file entering storage; returns its type or throws a user-facing message. */
export function assertOfficeFile(name: string, bytes: Uint8Array, maxBytes: number = MAKER_LIMITS.fileBytes): MakerFileType {
  const fileType = fileTypeForName(name)
  if (!fileType) throw new Error('Choose a .docx, .xlsx or .pptx file.')
  if (!bytes.length) throw new Error('This file is empty.')
  if (bytes.length > maxBytes) throw new Error(`Files must be smaller than ${Math.round(maxBytes / 1024 / 1024)} MB.`)
  if (!hasZipMagic(bytes)) throw new Error('This is not a valid Office file.')
  return fileType
}

const OFFICE_SCHEME: Record<MakerFileType, string> = { docx: 'ms-word', xlsx: 'ms-excel', pptx: 'ms-powerpoint' }

/** Links that open a WebDAV file in an installed app: Microsoft Office's URI scheme and LibreOffice's equivalent.
 *  `ofe` opens for editing, `ofv` read-only. */
export function officeAppLinks(fileType: MakerFileType, write: boolean, davUrl: string): { office: string; libreOffice: string } {
  const mode = write ? 'ofe' : 'ofv'
  return { office: `${OFFICE_SCHEME[fileType]}:${mode}|u|${davUrl}`, libreOffice: `vnd.libreoffice.command:${mode}|u|${davUrl}` }
}
