/** How GOMS relates to a tracked company. */
export const COMPETITOR_RELATIONSHIPS = ['competitor', 'partner', 'neutral', 'strategicThreat'] as const
export type CompetitorRelationship = typeof COMPETITOR_RELATIONSHIPS[number]

export const COMPETITOR_RELATIONSHIP_LABEL: Record<CompetitorRelationship, string> = {
  competitor: 'Competitor',
  partner: 'Partner',
  neutral: 'Neutral',
  strategicThreat: 'Strategic Threat',
}

/** The tag-list fields; each is entered with a chip input and validated by the same rules. */
export const COMPETITOR_LIST_FIELDS = ['offerings', 'subCategories', 'verticals', 'certifications', 'strengths'] as const
export type CompetitorListField = typeof COMPETITOR_LIST_FIELDS[number]

/** A rival (or partner) company tracked in Settings > Competitors (e.g. "SAS"), with its positioning and
 *  capabilities so pre-sales can compare at a glance. */
export interface Competitor {
  id: string
  name: string
  /** A `data:image/...;base64,` upload or an https link; null shows initials. */
  logo: string | null
  website: string | null
  relationship: CompetitorRelationship
  /** Primary industry / category, e.g. "Data Management Software". */
  category: string
  subCategories: string[]
  verticals: string[]
  certifications: string[]
  offerings: string[]
  strengths: string[]
  description: string
  createdAt: string
  updatedAt: string
}

export interface CompetitorInput {
  name: string
  logo?: string | null
  website?: string | null
  relationship?: CompetitorRelationship
  category?: string | null
  subCategories?: string[]
  verticals?: string[]
  certifications?: string[]
  offerings?: string[]
  strengths?: string[]
  description?: string | null
}

/** The stored shape after trimming and validation: every field present. */
export type NormalizedCompetitorInput = Omit<Competitor, 'id' | 'createdAt' | 'updatedAt'>

export interface TagLimits { max: number; each: number; label: string; plural: string }

export const COMPETITOR_LIST_LIMITS: Record<CompetitorListField, TagLimits> = {
  offerings: { max: 30, each: 60, label: 'offering', plural: 'offerings' },
  subCategories: { max: 10, each: 60, label: 'sub-category', plural: 'sub-categories' },
  verticals: { max: 15, each: 60, label: 'vertical', plural: 'verticals' },
  certifications: { max: 20, each: 60, label: 'certification', plural: 'certifications' },
  strengths: { max: 10, each: 200, label: 'strength', plural: 'strengths' },
}

export const COMPETITOR_LIMITS = {
  name: 120,
  category: 80,
  description: 2000,
  url: 2000,
  logoBytes: 256 * 1024,
  offerings: COMPETITOR_LIST_LIMITS.offerings.max,
  offering: COMPETITOR_LIST_LIMITS.offerings.each,
} as const

export const COMPETITOR_LOGO_TYPES = ['image/png', 'image/jpeg', 'image/svg+xml', 'image/webp'] as const

/** Longest data: URL a 256 KB image can encode to (base64 + the longest prefix). */
export const COMPETITOR_LOGO_DATA_URL_MAX = 'data:image/svg+xml;base64,'.length + Math.ceil(COMPETITOR_LIMITS.logoBytes / 3) * 4

const DATA_URL_PATTERN = /^data:(image\/(?:png|jpeg|svg\+xml|webp));base64,([A-Za-z0-9+/]+={0,2})$/

/** Decoded size of a base64 data: URL, or null when it is not an accepted image. */
export function logoDataUrlBytes(value: string): number | null {
  const match = DATA_URL_PATTERN.exec(value)
  if (!match) return null
  const body = match[2]
  const padding = body.endsWith('==') ? 2 : body.endsWith('=') ? 1 : 0
  return Math.floor((body.length * 3) / 4) - padding
}

function isHttpsUrl(value: string): boolean {
  try {
    const parsed = new URL(value)
    return parsed.protocol === 'https:' && !!parsed.hostname
  } catch {
    return false
  }
}

/** "sas.com" becomes "https://sas.com"; only https links are kept. Blank is null. */
export function normalizeCompetitorWebsite(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`
  if (withScheme.length > COMPETITOR_LIMITS.url) throw new Error('That website link is too long.')
  if (!isHttpsUrl(withScheme)) throw new Error('Enter a website starting with https://.')
  return withScheme
}

/** Accepts an uploaded PNG/JPG/SVG/WebP data: URL up to 256 KB, or an https image link. */
export function normalizeCompetitorLogo(value: string | null | undefined): string | null {
  const raw = (value ?? '').trim()
  if (!raw) return null
  if (raw.startsWith('data:')) {
    const bytes = logoDataUrlBytes(raw)
    if (bytes === null) throw new Error('Upload the logo as a PNG, JPG, SVG or WebP image.')
    if (bytes > COMPETITOR_LIMITS.logoBytes) throw new Error('Keep the logo under 256 KB.')
    return raw
  }
  if (raw.length > COMPETITOR_LIMITS.url) throw new Error('That logo link is too long.')
  if (!isHttpsUrl(raw)) throw new Error('Paste a logo link starting with https://.')
  return raw
}

/** Trims one tag, collapsing inner whitespace. */
export function normalizeOffering(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

/** Adds tags to a list, skipping blanks and case-insensitive duplicates.
 *  Throws when a tag is too long or the list would exceed its limit. */
export function addTags(current: readonly string[], raw: readonly string[], limits: TagLimits): string[] {
  return raw.reduce<string[]>((list, value) => {
    const tag = normalizeOffering(value)
    if (!tag || list.some(item => item.toLowerCase() === tag.toLowerCase())) return list
    if (tag.length > limits.each) throw new Error(`Keep each ${limits.label} under ${limits.each} characters.`)
    if (list.length >= limits.max) throw new Error(`Add at most ${limits.max} ${limits.plural}.`)
    return [...list, tag]
  }, [...current])
}

/** Offerings are the original tag field; kept as a shorthand. */
export function addOfferings(current: readonly string[], raw: readonly string[]): string[] {
  return addTags(current, raw, COMPETITOR_LIST_LIMITS.offerings)
}

function normalizeRelationship(value: string | undefined): CompetitorRelationship {
  if (value === undefined || value === '') return 'competitor'
  if (!(COMPETITOR_RELATIONSHIPS as readonly string[]).includes(value)) throw new Error('Choose a relationship status.')
  return value as CompetitorRelationship
}

/** Trims and validates a competitor; throws with a user-facing message. */
export function normalizeCompetitorInput(input: CompetitorInput): NormalizedCompetitorInput {
  const name = normalizeOffering(input.name ?? '')
  if (!name) throw new Error('Enter the competitor name.')
  if (name.length > COMPETITOR_LIMITS.name) throw new Error(`Keep the name under ${COMPETITOR_LIMITS.name} characters.`)
  const category = normalizeOffering(input.category ?? '')
  if (category.length > COMPETITOR_LIMITS.category) throw new Error(`Keep the category under ${COMPETITOR_LIMITS.category} characters.`)
  const description = (input.description ?? '').trim()
  if (description.length > COMPETITOR_LIMITS.description) throw new Error(`Keep the notes under ${COMPETITOR_LIMITS.description} characters.`)
  const list = (field: CompetitorListField) => addTags([], input[field] ?? [], COMPETITOR_LIST_LIMITS[field])
  return {
    name,
    logo: normalizeCompetitorLogo(input.logo),
    website: normalizeCompetitorWebsite(input.website),
    relationship: normalizeRelationship(input.relationship),
    category,
    subCategories: list('subCategories'),
    verticals: list('verticals'),
    certifications: list('certifications'),
    offerings: list('offerings'),
    strengths: list('strengths'),
    description,
  }
}

/** Names are unique, ignoring case. */
export function assertUniqueCompetitorName(
  existing: readonly Pick<Competitor, 'id' | 'name'>[], name: string, ownId?: string,
): void {
  const key = normalizeOffering(name).toLowerCase()
  if (existing.some(item => item.id !== ownId && item.name.trim().toLowerCase() === key)) {
    throw new Error(`A competitor named "${normalizeOffering(name)}" already exists.`)
  }
}

/** Up to two letters for the logo fallback tile, e.g. "Tata Consultancy" → "TC". */
export function competitorInitials(name: string): string {
  const words = name.trim().split(/[\s\-_.&]+/).filter(Boolean)
  if (!words.length) return '?'
  const letters = words.length === 1 ? words[0].slice(0, 2) : words[0][0] + words[1][0]
  return letters.toUpperCase()
}

/** Case-insensitive match on the name, category / sub-categories or any offering; a blank query matches all. */
export function competitorMatches(
  competitor: Pick<Competitor, 'name' | 'offerings'> & Partial<Pick<Competitor, 'category' | 'subCategories'>>, query: string,
): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  const fields = [competitor.name, competitor.category ?? '', ...(competitor.subCategories ?? []), ...competitor.offerings]
  return fields.some(field => field.toLowerCase().includes(q))
}
