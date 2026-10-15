/** Document maker: real Office files (.docx / .xlsx / .pptx) edited in ONLYOFFICE Docs.
 *  The bytes live server-side; this module holds the shared record shape and every rule both repositories enforce. */

export const MAKER_DOCUMENT_KINDS = ['document', 'spreadsheet', 'presentation'] as const
export type MakerDocumentKind = (typeof MAKER_DOCUMENT_KINDS)[number]

export const MAKER_FILE_TYPES = ['docx', 'xlsx', 'pptx'] as const
export type MakerFileType = (typeof MAKER_FILE_TYPES)[number]

/** ONLYOFFICE's `documentType` for each kind. */
export type OnlyofficeDocumentType = 'word' | 'cell' | 'slide'

export const FILE_TYPE_FOR_KIND: Record<MakerDocumentKind, MakerFileType> = {
  document: 'docx', spreadsheet: 'xlsx', presentation: 'pptx',
}
export const KIND_FOR_FILE_TYPE: Record<MakerFileType, MakerDocumentKind> = {
  docx: 'document', xlsx: 'spreadsheet', pptx: 'presentation',
}
export const DOCUMENT_TYPE_FOR_FILE_TYPE: Record<MakerFileType, OnlyofficeDocumentType> = {
  docx: 'word', xlsx: 'cell', pptx: 'slide',
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
  /** A version saved back by the Document Server. */
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
  /** Starts at 1; +1 for every version saved back from the editor or replaced by an upload. */
  version: number
  /** ONLYOFFICE `document.key`: a new value for every version, so the Document Server never serves a stale cache. */
  documentKey: string
  ownerEmail: string
  ownerName: string
  createdAt: string
  updatedAt: string
}

/** Unique per document and version, within ONLYOFFICE's key alphabet (`[0-9A-Za-z._=-]`, at most 128 characters). */
export function makerDocumentKey(id: string, version: number): string {
  const safe = id.replace(/[^0-9A-Za-z_-]/g, '')
  if (!safe || !Number.isInteger(version) || version < 1) throw new Error('Invalid document version.')
  return `${safe}-v${version}`.slice(0, 128)
}

/** True when `key` was issued for this document (any version). The callback of a session that began on an
 *  earlier version still carries that version's key. */
export function keyBelongsTo(id: string, key: unknown): boolean {
  if (typeof key !== 'string') return false
  const prefix = `${id.replace(/[^0-9A-Za-z_-]/g, '')}-v`
  return key.startsWith(prefix) && /^\d+$/.test(key.slice(prefix.length))
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
