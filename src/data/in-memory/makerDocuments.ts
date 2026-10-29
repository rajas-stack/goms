// Document maker in local (no API) mode: the records and their bytes live in the IndexedDB snapshot like every
// other entity, so the home list, upload, rename, duplicate, delete and download all work offline. Editing needs
// the ONLYOFFICE Document Server, which can only fetch files from the API — see MakerEditorUnavailable.
import {
  assertOfficeFile, blankOfficeFile, FILE_TYPE_FOR_KIND, KIND_FOR_FILE_TYPE, makerDocumentKey, MAKER_LIMITS,
  normalizeMakerTitle, titleFromFileName, type MakerDocument, type MakerDocumentKind,
} from '@goms/domain'
import { uid } from '@/lib/utils'

/** A local record carries its file as base64, so the snapshot stays JSON-safe for backups. */
export interface LocalMakerDocument extends MakerDocument { contentBase64: string }

export interface MakerOwner { email: string; name: string }

export const LOCAL_OWNER: MakerOwner = { email: 'local@this-device', name: 'This device' }

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}

export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}

export const toPublic = ({ contentBase64: _bytes, ...doc }: LocalMakerDocument): MakerDocument => doc

function record(kind: MakerDocumentKind, title: string, bytes: Uint8Array, owner: MakerOwner): LocalMakerDocument {
  const id = uid('mkd')
  const now = new Date().toISOString()
  return {
    id, kind, title, fileType: FILE_TYPE_FOR_KIND[kind], size: bytes.length, version: 1, documentKey: makerDocumentKey(id, 1),
    ownerEmail: owner.email, ownerName: owner.name, createdAt: now, updatedAt: now, contentBase64: bytesToBase64(bytes),
  }
}

export function createLocal(kind: MakerDocumentKind, title: string, owner: MakerOwner): LocalMakerDocument {
  return record(kind, normalizeMakerTitle(title), blankOfficeFile(FILE_TYPE_FOR_KIND[kind]), owner)
}

export function uploadLocal(name: string, base64: string, owner: MakerOwner): LocalMakerDocument {
  const bytes = base64ToBytes(base64)
  const fileType = assertOfficeFile(name, bytes, MAKER_LIMITS.uploadBytes)
  return record(KIND_FOR_FILE_TYPE[fileType], normalizeMakerTitle(titleFromFileName(name).slice(0, MAKER_LIMITS.title)), bytes, owner)
}

export function duplicateLocal(source: LocalMakerDocument): LocalMakerDocument {
  const copy = record(source.kind, `Copy of ${source.title}`.slice(0, MAKER_LIMITS.title), base64ToBytes(source.contentBase64), { email: source.ownerEmail, name: source.ownerName })
  return copy
}

export function renameLocal(doc: LocalMakerDocument, title: string): LocalMakerDocument {
  return { ...doc, title: normalizeMakerTitle(title), updatedAt: new Date().toISOString() }
}

export function replaceLocal(doc: LocalMakerDocument, name: string, base64: string): LocalMakerDocument {
  const bytes = base64ToBytes(base64)
  if (assertOfficeFile(name, bytes, MAKER_LIMITS.uploadBytes) !== doc.fileType) throw new Error(`Choose a .${doc.fileType} file.`)
  const version = doc.version + 1
  return { ...doc, size: bytes.length, version, documentKey: makerDocumentKey(doc.id, version), contentBase64: base64, updatedAt: new Date().toISOString() }
}

export function requireLocal(list: readonly LocalMakerDocument[], id: string): LocalMakerDocument {
  const doc = list.find((item) => item.id === id)
  if (!doc) throw new Error('File not found.')
  return doc
}

/** What `new DocsAPI.DocEditor(…)` needs: where api.js lives, and the server-signed config. */
export interface MakerEditorSession {
  documentServerUrl: string
  config: { token: string; documentType: string; document: { key: string; title: string }; [key: string]: unknown }
}

/** A link the browser can download the current version from. */
export interface MakerDownload { url: string; name: string }

/** Thrown by the local repository's editor-config call: there is no API for the Document Server to fetch from. */
export class MakerEditorUnavailable extends Error {
  constructor() { super('Editing needs the GOMS API and an ONLYOFFICE Document Server. This build runs offline (no VITE_API_BASE_URL).') }
}

export class MakerSharingUnavailable extends Error {
  constructor() { super('Sharing, version history, Google Drive upload and opening in an installed app need the GOMS server. Files on this device stay on this device.') }
}
