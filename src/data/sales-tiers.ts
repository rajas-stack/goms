/** The sales role ladder, as data rather than a TypeScript union — spec §6.1.
 *
 *  `rank` is what makes promote/demote detection possible: closing one posting
 *  and opening another with a lower rank IS a promotion, so `changeType` is
 *  derived rather than typed by the user. `active: false` retires a level
 *  without invalidating the postings that already reference it.
 *
 *  Keys are open strings. Never narrow this to a union — the config dialog
 *  edits this ladder, and a union would make user-added tiers a build error.
 *
 *  The data and `tierRank` now live in `@goms/domain` (shared with apps/api's
 *  sales router, which needs the same rank ordering to derive `changeType`
 *  consistently) — this file re-exports them and keeps the frontend-only
 *  label/parsing helpers below. */
import { SALES_TIERS, tierRank } from '@goms/domain'
export type { SalesTierDef } from '@goms/domain'
export { SALES_TIERS, tierRank }

const SALES_TIER_MAP: Record<string, import('@goms/domain').SalesTierDef> = Object.fromEntries(
  SALES_TIERS.map((t) => [t.key, t]),
)

/** The tier a person with no explicit mapping lands in — the widest rung. */
const DEFAULT_TIER_KEY = 'accountManager'

/** Falls back to the raw key so a retired or user-added tier still renders as
 *  something meaningful instead of blank. */
export function tierLabel(key: string): string {
  return SALES_TIER_MAP[key]?.label ?? key
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
