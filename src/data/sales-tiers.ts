/** The sales role ladder, as data rather than a TypeScript union — spec §6.1.
 *
 *  `rank` is what makes promote/demote detection possible: closing one posting
 *  and opening another with a lower rank IS a promotion, so `changeType` is
 *  derived rather than typed by the user. `active: false` retires a level
 *  without invalidating the postings that already reference it.
 *
 *  Keys are open strings. Never narrow this to a union — the config dialog
 *  edits this ladder, and a union would make user-added tiers a build error. */
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

/** The tier a person with no explicit mapping lands in — the widest rung. */
const DEFAULT_TIER_KEY = 'accountManager'

/** Falls back to the raw key so a retired or user-added tier still renders as
 *  something meaningful instead of blank. */
export function tierLabel(key: string): string {
  return SALES_TIER_MAP[key]?.label ?? key
}

export function tierRank(key: string): number {
  return SALES_TIER_MAP[key]?.rank ?? Number.MAX_SAFE_INTEGER
}

/** Maps a legacy `SALES_TEAM` designation string to a tier key. The existing
 *  roster has free-text designations ('Regional Manager & Head'), so this is a
 *  best-effort read used only by the seed migration; after that, tierKey is
 *  stored on the posting and this is never consulted again. */
export function tierKeyFromDesignation(designation: string): string {
  const d = designation.toLowerCase()
  if (d.includes('sales head')) return 'salesHead'
  // Checked before the bare 'regional manager' case so the dual-role
  // 'Regional Manager & Head' titles land on the senior rung they actually hold.
  if (d.includes('head')) return 'regionalHead'
  if (d.includes('general manager')) return 'gm'
  if (d.includes('regional manager')) return 'rm'
  return DEFAULT_TIER_KEY
}
