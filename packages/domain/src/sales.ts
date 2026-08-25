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
