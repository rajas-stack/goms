// The Directory's one list of people, built read-side from the records that already exist — nothing is copied or merged
// into a new store. Each entry keeps its source record's kind and id, so selecting, editing, transferring or deleting it
// always reaches the record it came from:
// - Internal (Amnex): the master employee list (org_people, Sales roster and hand-added team members, already
//   de-duplicated by explicit org link or email — never by name alone when both sides have an email).
// - External: Account Mapping people (government department contacts) and the e-mail address book (communication_contacts).
import { COMMUNICATION_PARTY_LABELS, formatAmnexId, type CommunicationContact, type ContactParty } from '@goms/domain'
import type { Employee } from '@/lib/types'
import type { MasterEmployee } from '@/features/org/masterEmployees'

export type ContactType = 'internal' | 'external'
/** Matches the workspace selection kinds, so `ws.select(entry.kind, entry.id)` opens the right profile. */
export type DirectoryKind = 'employee' | 'orgPerson' | 'salesPerson' | 'teamMember' | 'contact'

export interface DirectoryEntry {
  kind: DirectoryKind
  id: string
  name: string
  designation: string
  email: string
  phone: string
  photoUrl?: string | null
  contactType: ContactType
  /** Internal: the person's Amnex departments (several allowed). External: their one contact category. */
  groups: string[]
  /** The organisation or department they belong to — stored apart from the category. */
  organisation: string
  /** Read-only Directory ID: AIPL_<employee number> for Amnex, the category number for external people. */
  displayId?: string | null
}

export const entryKey = (entry: Pick<DirectoryEntry, 'kind' | 'id'>) => `${entry.kind}:${entry.id}`

/** Account Mapping people are client / government department contacts. */
export const DEPARTMENTAL: ContactParty = 'clientDepartment'

export function fromMasterEmployee(e: MasterEmployee, photoUrl?: string | null): DirectoryEntry {
  const kind: DirectoryKind = e.orgPersonId ? 'orgPerson' : e.key.startsWith('sales:') ? 'salesPerson' : 'teamMember'
  return {
    kind, id: e.orgPersonId ?? e.id ?? e.key, name: e.name, designation: e.designation, email: e.email, phone: '', photoUrl,
    contactType: 'internal', groups: e.departments, organisation: 'Amnex',
    displayId: e.employeeNumber ? formatAmnexId(e.employeeNumber) : null,
  }
}

export function fromAccountMappingPerson(e: Employee, department?: string): DirectoryEntry {
  return {
    kind: 'employee', id: e.id, name: e.name, designation: e.designation, email: e.email, phone: e.phone, photoUrl: e.photoUrl,
    contactType: 'external', groups: [DEPARTMENTAL], organisation: department || e.company,
    displayId: e.directoryNumber != null ? String(e.directoryNumber) : null,
  }
}

export function fromContact(c: CommunicationContact): DirectoryEntry {
  return {
    kind: 'contact', id: c.id, name: c.name || c.email, designation: '', email: c.email, phone: '',
    contactType: 'external', groups: [c.party], organisation: c.organization,
  }
}

const sameGroup = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase()

/** Both dropdowns: '' is "All". A category only narrows within its contact type. */
export function matchesType(entry: DirectoryEntry, type: ContactType | '', category: string): boolean {
  if (type && entry.contactType !== type) return false
  return !type || !category || entry.groups.some((g) => sameGroup(g, category))
}

/** Settings › Masters › Directory Types code → the contact category it lists. */
const PARTY_FOR_CODE: Record<string, ContactParty> = {
  department: 'clientDepartment', clientDepartment: 'clientDepartment', oem: 'oem', competitor: 'competitor',
  competitors: 'competitor', consortium: 'consortium', delivery: 'delivery', external: 'external',
}
export const partyForDirectoryType = (code: string): ContactParty | null => PARTY_FOR_CODE[code] ?? null

export interface CategoryOption { value: string; label: string }

/** Used until Settings › Masters › Directory Types has loaded (or when it is empty). */
const DEFAULT_EXTERNAL: CategoryOption[] = [
  { value: 'clientDepartment', label: 'Departmental' }, { value: 'oem', label: 'OEMs' },
  { value: 'competitor', label: 'Competitors' }, { value: 'consortium', label: 'Consortium Partners' },
]

/** External categories, named and ordered by the Directory Types master. */
export function externalCategories(directoryTypes: readonly { code: string; name: string }[]): CategoryOption[] {
  const fromMaster = directoryTypes.flatMap((d) => {
    const party = partyForDirectoryType(d.code)
    return party ? [{ value: party, label: d.name }] : []
  })
  return fromMaster.length ? fromMaster.filter((o, i) => fromMaster.findIndex((x) => x.value === o.value) === i) : DEFAULT_EXTERNAL
}

/** Internal categories: the Amnex Departments master, plus any other department someone already belongs to. */
export function internalCategories(masterDepartments: readonly string[], entries: readonly DirectoryEntry[]): CategoryOption[] {
  const extra = [...new Set(entries.filter((e) => e.contactType === 'internal').flatMap((e) => e.groups))]
    .filter((d) => !masterDepartments.some((m) => sameGroup(m, d)))
    .sort((a, b) => a.localeCompare(b))
  return [...masterDepartments, ...extra].map((d) => ({ value: d, label: d }))
}

export const categoryLabel = (party: string, options: readonly CategoryOption[]) =>
  options.find((o) => o.value === party)?.label ?? COMMUNICATION_PARTY_LABELS[party as ContactParty] ?? party

/** `?type=` / `?cat=` → the dropdown values. An old `/teams?type=<Directory Types code>` link still opens its category. */
export function readTypeFilter(type: string | null, category: string | null): { type: ContactType | ''; category: string } {
  if (type === 'internal' || type === 'external') return { type, category: category ?? '' }
  const party = type ? partyForDirectoryType(type) : null
  return party ? { type: 'external', category: party } : { type: '', category: '' }
}
