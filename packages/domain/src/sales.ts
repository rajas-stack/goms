export interface SalesTierDef {
  key: string
  label: string
  /** 0 = most senior. Drives promote/demote detection. */
  rank: number
  active: boolean
}

export const SALES_TIERS: SalesTierDef[] = [
  { key: 'salesHead', label: 'Sales Head', rank: 0, active: true },
  { key: 'regionalHead', label: 'Regional Head', rank: 1, active: true },
  { key: 'gm', label: 'General Manager', rank: 2, active: true },
  { key: 'rm', label: 'Regional Manager', rank: 3, active: true },
  { key: 'accountManager', label: 'Account Manager', rank: 4, active: true },
]

const SALES_TIER_MAP: Record<string, SalesTierDef> = Object.fromEntries(
  SALES_TIERS.map((t) => [t.key, t]),
)

export function tierRank(key: string): number {
  return SALES_TIER_MAP[key]?.rank ?? Number.MAX_SAFE_INTEGER
}

// ── Editing a posting's effective dates ─────────────────────────────────────
// Postings are half-open intervals: `startDate` inclusive, `endDate` EXCLUSIVE
// (null = still current), and a handover is exactly `next.startDate ===
// prev.endDate`. People think in "last day held", so the edit takes that and
// this module converts. The rules live here, once, so the API and the
// in-memory repository can't drift apart.

export interface PostingInterval {
  id: string
  startDate: string
  endDate: string | null
}

export interface PostingDatesEdit {
  /** New effective-from. Omit to leave unchanged. */
  startDate?: string
  /** New effective-to as the LAST DAY HELD (inclusive). `null` = Present
   *  (open, i.e. the current posting). Omit to leave unchanged. */
  lastDayHeld?: string | null
}

export interface PostingDatesPlan {
  startDate: string
  /** Stored, exclusive end. */
  endDate: string | null
  /** The earlier posting whose end must move so history stays contiguous. */
  previous?: { id: string; endDate: string }
}

/** A user-correctable problem with the requested dates (maps to HTTP 400). */
export class PostingDatesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'PostingDatesError'
  }
}

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/

export function isValidIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s)
  if (!m) return false
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])]
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** Calendar arithmetic in UTC so it is immune to the machine's timezone/DST. */
export function addDays(iso: string, days: number): string {
  const m = ISO_DATE.exec(iso)!
  const t = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days))
  return t.toISOString().slice(0, 10)
}

export function planPostingDatesEdit(postings: PostingInterval[], postingId: string, edit: PostingDatesEdit): PostingDatesPlan {
  const row = postings.find((p) => p.id === postingId)
  if (!row) throw new PostingDatesError('That posting no longer exists.')

  const startDate = edit.startDate ?? row.startDate
  if (!isValidIsoDate(startDate)) throw new PostingDatesError('Effective from is not a valid date.')

  let endDate: string | null
  if (edit.lastDayHeld === undefined) endDate = row.endDate
  else if (edit.lastDayHeld === null) endDate = null
  else {
    if (!isValidIsoDate(edit.lastDayHeld)) throw new PostingDatesError('Effective to is not a valid date.')
    endDate = addDays(edit.lastDayHeld, 1)
  }

  const others = postings.filter((p) => p.id !== row.id)
  const previous = others.filter((p) => p.startDate < row.startDate).sort((a, b) => b.startDate.localeCompare(a.startDate))[0]
  const next = others.filter((p) => p.startDate > row.startDate).sort((a, b) => a.startDate.localeCompare(b.startDate))[0]

  if (endDate !== null && endDate <= startDate) {
    throw new PostingDatesError('Effective to must be on or after Effective from.')
  }
  if (endDate === null) {
    if (next) throw new PostingDatesError(`A later posting starts on ${next.startDate}, so this one can't be open-ended.`)
    if (others.some((p) => p.endDate === null)) throw new PostingDatesError('Another posting is already current.')
  } else if (next && endDate !== next.startDate) {
    throw new PostingDatesError(
      `The next posting starts on ${next.startDate}. To move the boundary, edit that posting's Effective from instead.`,
    )
  }

  let plan: PostingDatesPlan = { startDate, endDate }
  if (previous && startDate !== row.startDate) {
    if (startDate <= previous.startDate) {
      throw new PostingDatesError(`Effective from must be after the previous posting's start (${previous.startDate}).`)
    }
    // Keep history contiguous: the earlier posting hands over on the new date.
    if (previous.endDate !== null && (previous.endDate === row.startDate || previous.endDate > startDate)) {
      plan = { ...plan, previous: { id: previous.id, endDate: startDate } }
    }
  }
  return plan
}
