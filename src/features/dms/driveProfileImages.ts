import { directoryCategoryKey, matchCategoryPhotos, personNameKey, type PhotoPerson } from '@goms/domain'
import { folderIdFromInput } from './settings'
import { connectDrive, downloadFile, getDriveSession, listFiles, type DriveFile } from './googleDrive'

/** Serverless (Vite local mode) photo source: the browser reads one Drive folder per people category. */
export const DRIVE_PHOTOS_CONNECTION = 'profile-photos'

export interface PhotoCategoryOption { key: string; label: string; hint: string }

/** Amnex rosters are fixed; external categories follow Settings → Masters → Directory Types (new ones included). */
const AMNEX_PHOTO_CATEGORIES: PhotoCategoryOption[] = [
  { key: 'internal', label: 'Amnex Employees', hint: 'Org structure · matched by employee number or name' },
  { key: 'sales', label: 'Sales Team', hint: 'Sales roster · matched by employee number or name' },
  { key: 'delivery', label: 'Delivery Team', hint: 'Delivery roster · matched by employee number or name' },
]
const DEFAULT_DIRECTORY_TYPES = [
  { code: 'department', name: 'Client Departments' }, { code: 'oem', name: 'OEMs' }, { code: 'competitor', name: 'Competitors' },
  { code: 'consortium', name: 'Consortium Partners' }, { code: 'external', name: 'Others' },
]

export function photoCategories(directoryTypes: readonly { code: string; name: string }[]): PhotoCategoryOption[] {
  const external = (directoryTypes.length ? directoryTypes : DEFAULT_DIRECTORY_TYPES).flatMap((t) => {
    const key = directoryCategoryKey(t.code)
    return key ? [{ key, label: t.name, hint: 'Matched by Directory ID or name' }] : []
  })
  return [...AMNEX_PHOTO_CATEGORIES, ...external.filter((c, i) => external.findIndex((x) => x.key === c.key) === i)]
}

export type PhotoFolders = Record<string, string>
const FOLDERS_KEY = 'goms:profile-photos-folders'

export function loadPhotoFolders(): PhotoFolders {
  try {
    const saved = JSON.parse(localStorage.getItem(FOLDERS_KEY) ?? '{}') as Record<string, unknown>
    return Object.fromEntries(Object.entries(saved).filter((e): e is [string, string] => typeof e[1] === 'string' && !!e[1]))
  } catch { return {} }
}

/** Validates every link first, so one bad paste saves nothing. Empty input clears that category. */
export function savePhotoFolders(input: Record<string, string>, categories: readonly PhotoCategoryOption[]): PhotoFolders {
  const out: PhotoFolders = {}
  for (const { key, label } of categories) {
    const value = input[key]?.trim()
    if (!value) continue
    try { out[key] = folderIdFromInput(value) } catch { throw new Error(`${label}: enter a Google Drive folder URL or folder ID.`) }
  }
  try { localStorage.setItem(FOLDERS_KEY, JSON.stringify(out)) } catch { throw new Error('This browser blocked saving the photo folders.') }
  return out
}

export const hasPhotoFolders = () => Object.keys(loadPhotoFolders()).length > 0

export type PhotoFile = Pick<DriveFile, 'id' | 'name' | 'modifiedTime'>
export interface FolderListing { category: string; files: PhotoFile[]; error?: string }

/** One listing per configured folder. Null when Drive is not connected; one unreadable folder never hides the others. */
export async function fetchDriveFolderListings(): Promise<FolderListing[] | null> {
  const folders = Object.entries(loadPhotoFolders())
  if (!folders.length || !getDriveSession(DRIVE_PHOTOS_CONNECTION)) return null
  return Promise.all(folders.map(([category, id]) => listFiles(id, DRIVE_PHOTOS_CONNECTION)
    .then((files) => ({ category, files }), (error: unknown) => ({ category, files: [], error: error instanceof Error ? error.message : 'Folder could not be read.' }))))
}

export interface CategoryReport {
  photos: number; used: number; missing: number
  duplicates: string[]; conflicts: string[]; unmatched: string[]; warnings: string[]; error?: string
}
export interface DrivePhotoIndex {
  configured: boolean
  /** Drive file id → version, for cache-busting avatar fetches. */
  versions: Record<string, string>
  /** Person row id → Drive file id (every linked row of one human shares the photo). */
  people: Record<string, string>
  /** Unique person name key → Drive file id, for avatars rendered from a name alone. */
  names: Record<string, string>
  report: Record<string, CategoryReport>
}

const IMAGE = /\.(jpe?g|png|webp)$/i

/** Matches each folder only against its own category's people, then lets linked rows of one human
 *  (org person, team mirrors, Sales row) share whichever photo was found for them. */
export function buildDrivePhotoIndex(
  listings: readonly FolderListing[], peopleByCategory: Record<string, readonly PhotoPerson[]>, linkedGroups: readonly (readonly string[])[] = [],
): DrivePhotoIndex {
  const index: DrivePhotoIndex = { configured: true, versions: {}, people: {}, names: {}, report: {} }
  const nameOf = new Map<string, string>()
  for (const { category, files, error } of listings) {
    const people = peopleByCategory[category] ?? []
    for (const p of people) nameOf.set(p.id, p.name)
    const match = matchCategoryPhotos(files, people)
    const photos = files.filter((f) => IMAGE.test(f.name))
    index.report[category] = {
      photos: photos.length, used: Object.keys(match.mappings).length, missing: match.missing.length,
      duplicates: match.duplicates, conflicts: match.conflicts, unmatched: match.unmatched, warnings: match.warnings, ...(error ? { error } : {}),
    }
    for (const [personId, fileId] of Object.entries(match.mappings)) {
      index.people[personId] = fileId
      const file = files.find((f) => f.id === fileId)!
      index.versions[fileId] = file.modifiedTime ?? fileId
    }
  }
  for (const group of linkedGroups) {
    const shared = group.map((id) => index.people[id]).find(Boolean)
    if (shared) for (const id of group) index.people[id] ??= shared
  }
  const byName = new Map<string, Set<string>>()
  for (const [personId, fileId] of Object.entries(index.people)) {
    const key = personNameKey(nameOf.get(personId) ?? '')
    if (key) byName.set(key, (byName.get(key) ?? new Set()).add(fileId))
  }
  for (const [key, fileIds] of byName) if (fileIds.size === 1) index.names[key] = [...fileIds][0]
  return index
}

/** Must run synchronously inside a click (Google's popup needs the gesture). */
export function connectDrivePhotos() {
  return connectDrive(import.meta.env.VITE_GOOGLE_OAUTH_CLIENT_ID ?? '', DRIVE_PHOTOS_CONNECTION)
}

const blobs = new Map<string, Promise<Blob>>()
/** shortcut: in-memory per tab, so a reload re-downloads; fine for a few hundred small avatars. */
export function driveProfileBlob(fileId: string, version: string): Promise<Blob> {
  const key = `${fileId}:${version}`
  let blob = blobs.get(key)
  if (!blob) {
    blob = downloadFile(fileId, DRIVE_PHOTOS_CONNECTION)
    blob.catch(() => blobs.delete(key))
    blobs.set(key, blob)
  }
  return blob
}
