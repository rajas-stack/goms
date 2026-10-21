import { createHash } from 'node:crypto'

export interface ProfileFile {
  id: string; name: string; mimeType: string; parents?: string[]; trashed?: boolean
  version?: string; modifiedTime?: string; md5Checksum?: string
}
export type ProfileScope = 'contacts' | 'internal' | 'sales'
export interface ProfilePerson { id: string; name: string; email: string | null; code?: string; source?: string; orgPersonId?: string | null }
export interface ProfileMapping { fileId: string; version: string; scope?: ProfileScope; nameKey?: string }
export const profileScope = (person: ProfilePerson): ProfileScope => !person.source || person.source === 'contacts' ? 'contacts' : person.source === 'sales' ? 'sales' : 'internal'
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
/** Keep in sync with src/lib/profileNameKey.ts — the browser resolves id-less avatars by this key. */
export const nameKey = (value: string) => key(value).replace(/^(mr|mrs|ms|dr)\.?\s+/i, '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/[^\p{L}\p{N}]/gu, '')
export const isProfileImage = (file: ProfileFile) => !file.trashed && /\.(jpe?g|png|webp)$/i.test(file.name) && ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimeType)
export function profileVersion(folderId: string, file: ProfileFile): string {
  return createHash('sha256').update(JSON.stringify([folderId, file.id, file.version, file.modifiedTime, file.md5Checksum])).digest('hex').slice(0, 24)
}
/** Matches by full name only. Ambiguous names are never guessed; a photo whose person
 *  does not exist yet is `waiting` (not an error) and binds on a later sync. */
export function mapProfileImages(folderId: string, files: ProfileFile[], people: ProfilePerson[]) {
  // One human can have an org row, team mirrors and a Sales row. Share their photo,
  // while keeping unrelated same-name people and duplicate identities ambiguous.
  const roots = new Map(people.map(p => [p.id, p.id]))
  const root = (id: string): string => { const parent = roots.get(id)!; if (parent === id) return id; const found = root(parent); roots.set(id, found); return found }
  const join = (group: ProfilePerson[]) => { for (const p of group.slice(1)) roots.set(root(p.id), root(group[0].id)) }
  const internal = people.filter(p => p.source && p.source !== 'contacts')
  const org = new Map(internal.filter(p => p.source === 'org').map(p => [p.id, p]))
  for (const p of internal) if (p.orgPersonId && org.has(p.orgPersonId)) join([org.get(p.orgPersonId)!, p])
  const groups = (by: (p: ProfilePerson) => string) => {
    const result = new Map<string, ProfilePerson[]>()
    for (const p of internal) { const value = by(p); if (value) result.set(value, [...(result.get(value) ?? []), p]) }
    return result.values()
  }
  const distinctSources = (group: ProfilePerson[]) => {
    const seen = new Map<string, string>()
    for (const p of group) { const previous = seen.get(p.source!); if (previous && previous !== root(p.id)) return false; seen.set(p.source!, root(p.id)) }
    return true
  }
  for (const group of groups(p => key(p.email ?? ''))) if (distinctSources(group)) join(group)
  for (const group of groups(p => nameKey(p.name))) {
    const emails = new Set(group.map(p => key(p.email ?? '')).filter(Boolean))
    if (emails.size <= 1 && distinctSources(group)) join(group)
  }
  const names = new Map<string, Set<string>>(); const displayName = new Map<string, string>()
  for (const person of people) {
    const value = nameKey(person.name); if (!value) continue
    const ids = names.get(value) ?? new Set<string>(); ids.add(root(person.id)); names.set(value, ids)
    displayName.set(root(person.id), person.name)
  }
  const candidates = new Map<string, ProfileFile[]>(); const errors: string[] = []; const waiting: string[] = []
  for (const file of files.filter(isProfileImage)) {
    const ids = names.get(nameKey(file.name.replace(/\.(jpe?g|png|webp)$/i, '')))
    if (!ids?.size) { waiting.push(file.name); continue }
    if (ids.size !== 1) { errors.push(`${file.name}: more than one person has this name, so no photo was assigned.`); continue }
    const id = [...ids][0]; candidates.set(id, [...(candidates.get(id) ?? []), file])
  }
  const mappings: Record<string, ProfileMapping> = Object.create(null)
  for (const [id, matched] of candidates) {
    if (matched.length !== 1) { errors.push(`${displayName.get(id)} has ${matched.length} photos (${matched.map(f => f.name).join(', ')}). Keep one.`); continue }
    const file = matched[0]
    for (const person of people.filter(p => root(p.id) === id)) mappings[person.id] = { fileId: file.id, version: profileVersion(folderId, file), nameKey: nameKey(person.name), ...(person.source ? { scope: profileScope(person) } : {}) }
  }
  return { mappings, errors, waiting }
}
