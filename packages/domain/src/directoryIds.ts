// Directory person IDs: fixed 5,000-wide numeric ranges per external category, Amnex employee
// numbers (AIPL_<number>), and Drive photo filename matching against both IDs and names.

export const DIRECTORY_RANGE_SIZE = 5000
/** Custom categories (added through Settings → Masters) start after the last built-in range. */
export const FIRST_CUSTOM_RANGE_START = 26001

export interface DirectoryRange { categoryKey: string; rangeStart: number; rangeEnd: number; nextValue: number }

const builtin = (categoryKey: string, rangeStart: number): DirectoryRange =>
  ({ categoryKey, rangeStart, rangeEnd: rangeStart + DIRECTORY_RANGE_SIZE - 1, nextValue: rangeStart })

export const BUILTIN_DIRECTORY_RANGES: readonly DirectoryRange[] = [
  builtin('clientDepartment', 1001), builtin('oem', 6001), builtin('competitor', 11001),
  builtin('consortium', 16001), builtin('external', 21001),
]

/** Next unallocated range. `existing` must include every range ever issued (deleted categories too)
 *  so a range is never handed out twice. */
export function nextDirectoryRange(existing: readonly Pick<DirectoryRange, 'rangeStart' | 'rangeEnd'>[]): { rangeStart: number; rangeEnd: number } {
  const lastEnd = Math.max(FIRST_CUSTOM_RANGE_START - 1, ...existing.map(r => r.rangeEnd))
  return { rangeStart: lastEnd + 1, rangeEnd: lastEnd + DIRECTORY_RANGE_SIZE }
}

export class DirectoryRangeFullError extends Error {
  constructor(readonly categoryKey: string) {
    super(`All ${DIRECTORY_RANGE_SIZE.toLocaleString('en-IN')} IDs for this category are used.`)
    this.name = 'DirectoryRangeFullError'
  }
}

/** Pure allocation for the browser store; the server does the same in one locked SQL UPDATE. */
export function allocateDirectoryNumber(range: DirectoryRange): { number: number; range: DirectoryRange } {
  if (range.nextValue > range.rangeEnd) throw new DirectoryRangeFullError(range.categoryKey)
  return { number: range.nextValue, range: { ...range, nextValue: range.nextValue + 1 } }
}

export const AMNEX_ID_PREFIX = 'AIPL_'
export const formatAmnexId = (employeeNumber: string) => `${AMNEX_ID_PREFIX}${employeeNumber}`

/** The employee number exactly as typed — text, so leading zeros survive. A pasted AIPL_/APIL prefix is dropped. */
export function parseEmployeeNumber(input: string): string | null {
  return /^(?:a(?:ip|pi)l[\s_-]*)?(\d{1,20})$/i.exec(input.trim())?.[1] ?? null
}

/** Keep in sync with src/lib/profileNameKey.ts: case, titles, accents and punctuation are ignored. */
export const personNameKey = (value: string): string =>
  value.normalize('NFKC').trim().toLowerCase()
    .replace(/^(mr|mrs|ms|dr)\.?\s+/i, '')
    .normalize('NFKD').replace(/\p{M}/gu, '')
    .replace(/[^\p{L}\p{N}]/gu, '')

const PHOTO_EXTENSION = /\.(jpe?g|png|webp)$/i
const PREFIXED_TRAILING = /^(?:(.*?) )?a(?:ip|pi)l ?(\d+)$/i
const TRAILING = /^(?:(.*) )?(\d+)$/
const LEADING = /^(?:a(?:ip|pi)l ?)?(\d+) (.+)$/i

/** Reads `6001.jpg`, `AIPL-1234.jpg`, `Asha Rao.jpg`, `Asha Rao 6001.jpg` or `6001 - Asha Rao.jpg`.
 *  Numbers are kept as text: `0123` and `123` are different IDs. Returns null for non-images. */
export function parsePhotoFilename(fileName: string): { number: string | null; nameKey: string | null } | null {
  if (!PHOTO_EXTENSION.test(fileName)) return null
  const folded = fileName.replace(PHOTO_EXTENSION, '').normalize('NFKC').replace(/[\s_.-]+/g, ' ').trim()
  let number: string | null = null
  let name = folded
  const trailing = PREFIXED_TRAILING.exec(folded) ?? TRAILING.exec(folded)
  const leading = trailing ? null : LEADING.exec(folded)
  if (trailing) { number = trailing[2]; name = trailing[1] ?? '' }
  else if (leading) { number = leading[1]; name = leading[2] }
  return { number, nameKey: personNameKey(name) || null }
}

export interface PhotoPerson { id: string; name: string; numbers: readonly string[] }
export interface CategoryPhotoMatch {
  /** person id → Drive file id */
  mappings: Record<string, string>
  duplicates: string[]
  conflicts: string[]
  unmatched: string[]
  warnings: string[]
  /** ids of people with no photo */
  missing: string[]
}

/** Matches one category folder's files to that category's people. Nothing is guessed: unknown IDs,
 *  shared names, name/ID disagreements and two photos for one person all stay unmatched and reported. */
export function matchCategoryPhotos(files: readonly { id: string; name: string }[], people: readonly PhotoPerson[]): CategoryPhotoMatch {
  const index = (keys: (p: PhotoPerson) => readonly string[]) => {
    const map = new Map<string, PhotoPerson[]>()
    for (const p of people) for (const key of new Set(keys(p))) map.set(key, [...(map.get(key) ?? []), p])
    return map
  }
  const byNumber = index(p => p.numbers.filter(Boolean))
  const byName = index(p => [personNameKey(p.name)].filter(Boolean))
  const result: CategoryPhotoMatch = { mappings: {}, duplicates: [], conflicts: [], unmatched: [], warnings: [], missing: [] }
  const candidates = new Map<string, { id: string; name: string }[]>()
  const pick = (person: PhotoPerson, file: { id: string; name: string }) => candidates.set(person.id, [...(candidates.get(person.id) ?? []), file])

  for (const file of files) {
    const parsed = parsePhotoFilename(file.name)
    if (!parsed) continue
    const named = parsed.nameKey ? byName.get(parsed.nameKey) : undefined
    if (parsed.number) {
      const owners = byNumber.get(parsed.number)
      if (!owners) { result.unmatched.push(`${file.name}: no person has ID ${parsed.number}.`); continue }
      if (owners.length > 1) { result.conflicts.push(`${file.name}: ID ${parsed.number} belongs to more than one person.`); continue }
      const [owner] = owners
      if (named && !named.includes(owner)) {
        result.conflicts.push(`${file.name}: the name is ${named[0].name} but ID ${parsed.number} belongs to ${owner.name}.`)
        continue
      }
      if (parsed.nameKey && !named) result.warnings.push(`${file.name}: matched by ID ${parsed.number} to ${owner.name}; the name in the file differs.`)
      pick(owner, file)
      continue
    }
    if (!named) { result.unmatched.push(`${file.name}: no person with this name or ID.`); continue }
    if (named.length > 1) { result.unmatched.push(`${file.name}: more than one person is named ${named[0].name}. Add their ID to the file name.`); continue }
    pick(named[0], file)
  }

  for (const person of people) {
    const matched = candidates.get(person.id)
    if (matched?.length === 1) result.mappings[person.id] = matched[0].id
    else {
      if (matched) result.duplicates.push(`${person.name} has ${matched.length} photos (${matched.map(f => f.name).join(', ')}). Keep one.`)
      result.missing.push(person.id)
    }
  }
  return result
}

// Built-in Directory Types codes (and their legacy spellings) share the five fixed ranges.
const BUILTIN_CATEGORY_FOR_CODE: Record<string, string> = {
  department: 'clientDepartment', clientdepartment: 'clientDepartment', oem: 'oem', competitor: 'competitor',
  competitors: 'competitor', consortium: 'consortium', external: 'external', others: 'external',
}
/** Amnex people ('internal') and Delivery mailboxes carry no numeric range. */
const UNNUMBERED_CODES = new Set(['internal', 'delivery'])

/** Range key for a Directory Types master code: a built-in range, the code itself for a custom category, or null. */
export function directoryCategoryKey(code: string): string | null {
  const key = code.trim().toLowerCase()
  if (!key || UNNUMBERED_CODES.has(key)) return null
  return BUILTIN_CATEGORY_FOR_CODE[key] ?? key
}

/** Gives every category code that lacks one the next range, in the order given. Returns `ranges` itself when nothing is new. */
export function ensureCategoryRanges(ranges: readonly DirectoryRange[], codes: readonly string[]): readonly DirectoryRange[] {
  let out = ranges
  for (const code of codes) {
    const categoryKey = directoryCategoryKey(code)
    if (!categoryKey || out.some(r => r.categoryKey === categoryKey)) continue
    const { rangeStart, rangeEnd } = nextDirectoryRange(out)
    out = [...out, { categoryKey, rangeStart, rangeEnd, nextValue: rangeStart }]
  }
  return out
}

/** The holder blocking `number`, if any. One human on several rosters (same email) may reuse their own number. */
export function employeeNumberClash<T extends { number: string; email: string }>(number: string, email: string, holders: readonly T[]): T | null {
  const mine = email.trim().toLowerCase()
  return holders.find(h => h.number === number && !(mine && h.email.trim().toLowerCase() === mine)) ?? null
}
