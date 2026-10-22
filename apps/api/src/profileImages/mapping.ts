import { createHash } from 'node:crypto'

export interface ProfileFile {
  id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean
  version?: string; modifiedTime?: string; md5Checksum?: string
}
export interface ProfilePerson { id: string; name: string; email: string | null; code?: string }
export interface ProfileMapping { fileId: string; version: string }
export function profileFolderId(input: string): string {
  const value = input.trim()
  if (!value || /^[\w-]+$/.test(value)) return value
  try {
    const url = new URL(value)
    const id = url.pathname.match(/^\/drive\/(?:u\/\d+\/)?folders\/([\w-]+)\/?$/)?.[1] ?? (url.pathname === '/open' ? url.searchParams.get('id') : null)
    if (url.protocol === 'https:' && url.hostname === 'drive.google.com' && !url.username && !url.password && id && /^[\w-]+$/.test(id)) return id
  } catch { /* A single validation message for malformed inputs. */ }
  throw new Error('Enter a Google Drive folder URL or folder ID.')
}
const key = (value: string) => value.normalize('NFKC').trim().toLowerCase()
const nameKey = (value: string) => key(value).normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
export const isProfileImage = (file: ProfileFile) => !file.trashed && /\.(jpe?g|png|webp)$/i.test(file.name) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)
export function profileVersion(folderId: string, file: ProfileFile): string {
  return createHash('sha256').update(JSON.stringify([folderId, file.id, file.version, file.modifiedTime, file.md5Checksum])).digest('hex').slice(0, 24)
}
/** Ambiguous identities or files are never guessed. IDs/emails win before the name fallback. */
export function mapProfileImages(folderId: string, files: ProfileFile[], people: ProfilePerson[]) {
  const exact = new Map<string, Set<string>>(); const names = new Map<string, Set<string>>()
  const add = (map: Map<string, Set<string>>, value: string, id: string) => {
    if (!value) return
    const ids = map.get(value) ?? new Set<string>(); ids.add(id); map.set(value, ids)
  }
  for (const person of people) {
    for (const value of [person.id, person.email, person.code]) if (value) add(exact, key(value), person.id)
    add(names, nameKey(person.name), person.id)
  }
  const candidates = new Map<string, { rank: number; files: ProfileFile[] }>(); const errors: string[] = []
  for (const file of files.filter(isProfileImage)) {
    const stem = file.name.replace(/\.(jpe?g|png|webp)$/i, '')
    const ids = exact.get(key(stem)) ?? names.get(nameKey(stem))
    if (!ids?.size) continue
    if (ids.size !== 1) { errors.push(`Ambiguous filename: ${file.name}. Use a unique user ID or email.`); continue }
    const id = [...ids][0]; const rank = exact.has(key(stem)) ? 2 : 1; const previous = candidates.get(id)
    if (!previous || rank > previous.rank) candidates.set(id, { rank, files: [file] })
    else if (rank === previous.rank) previous.files.push(file)
  }
  const mappings: Record<string, ProfileMapping> = Object.create(null)
  for (const [id, candidate] of candidates) {
    if (candidate.files.length !== 1) { errors.push(`Multiple images match user ${id}. Keep one matching filename.`); continue }
    const file = candidate.files[0]; mappings[id] = { fileId: file.id, version: profileVersion(folderId, file) }
  }
  return { mappings, errors }
}
