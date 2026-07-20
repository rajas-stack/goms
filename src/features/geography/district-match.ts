/** The bundled district boundaries carry the *shapefile's* own LGD district
 *  code, which uses different numbering than this app's district `code`
 *  (sourced from a separate admin list) — so unlike taluka/village, district
 *  boundaries must join by *name*, not code. Names still drift between the
 *  two sources ("Kachchh" vs "Kutch") or the district was renamed/split since
 *  the boundary source's vintage ("Gurgaon" → "Gurugram"). Matching is tried
 *  in order of how much it trusts the result:
 *
 *  1. Exact name match — always wins, even over an alias. This matters
 *     because a handful of old names are still real district names
 *     *elsewhere*: Karnataka's "Bijapur" was renamed to "Vijayapura", but
 *     Chhattisgarh has its own, still-current "Bijapur" — that one must
 *     match itself, not fall through to Karnataka's alias.
 *  2. A curated alias for known renames/translations too different for
 *     edit distance to bridge safely.
 *  3. Edit distance within a tolerance proportional to name length, for
 *     ordinary spelling drift.
 *  4. A parenthetical split — "Kaimur (Bhabua)" and "Sant Ravi Das
 *     Nagar(Bhadohi)" carry a qualifier that's sometimes the noise (the
 *     base name is the real match) and sometimes the *actual* current name
 *     (the parenthetical is). Both halves get a full retry through 1–3.
 *
 *  A blanket "one name contains the other" heuristic was tried and
 *  reverted: it silently merged real, distinct districts that happen to
 *  share a prefix ("Mumbai Suburban" is not "Mumbai"; "Tehri Garhwal" is
 *  not the old undivided "Garhwal"). Getting a false match is worse than
 *  getting no match, so shapes that clear none of the steps above are
 *  left unmatched. */

/** Old/renamed shape name → current app name. Keyed by the shape's own
 *  name (case-insensitive, parenthetical included). Only consulted after
 *  an exact match fails, so a same-named district elsewhere that's still
 *  current can never be shadowed by another state's alias. */
const ALIASES: Record<string, string> = {
  kachchh: 'kutch', // Gujarat
  'the dangs': 'dang', // Gujarat
  garhwal: 'pauri garhwal', // Uttarakhand — old name; "Tehri Garhwal" was already split out
  gurgaon: 'gurugram', // Haryana, renamed 2016
  mewat: 'nuh', // Haryana, renamed 2016
  'lahul & spiti': 'lahaul and spiti', // Himachal Pradesh
  'pashchim champaran': 'west champaran', // Bihar
  'purba champaran': 'east champaran', // Bihar
  'pashchimi singhbhum': 'west singhbhum', // Jharkhand
  'purbi singhbhum': 'east singhbhum', // Jharkhand
  bangalore: 'bengaluru urban', // Karnataka, renamed 2014
  belgaum: 'belagavi', // Karnataka, renamed 2014
  bijapur: 'vijayapura', // Karnataka, renamed 2014 (Chhattisgarh's own "Bijapur" hits the exact-match step first)
  gulbarga: 'kalaburagi', // Karnataka, renamed 2014
  shimoga: 'shivamogga', // Karnataka, renamed 2014
  'east nimar': 'khandwa', // Madhya Pradesh, old Nimar-region name
  'west nimar': 'khargone', // Madhya Pradesh, old Nimar-region name
  baleshwar: 'balasore', // Odisha
  muktsar: 'sri muktsar sahib', // Punjab, renamed 2016
  'sahibzada ajit singh nagar': 's.a.s. nagar', // Punjab, same district spelled out
  allahabad: 'prayagraj', // Uttar Pradesh, renamed 2018
  faizabad: 'ayodhya', // Uttar Pradesh, renamed 2018
  'mahamaya nagar': 'hathras', // Uttar Pradesh, reverted 2012
  'jyotiba phule nagar': 'amroha', // Uttar Pradesh, reverted 2012
  'kansiram nagar': 'kasganj', // Uttar Pradesh, reverted 2012
  kheri: 'lakhimpur kheri', // Uttar Pradesh
  haora: 'howrah', // West Bengal
  hugli: 'hooghly', // West Bengal
  east: 'east sikkim',
  west: 'west sikkim',
  north: 'north sikkim',
  south: 'south sikkim',
}

function normalize(name: string): string {
  return name.toLowerCase().replace(/[^a-z]/g, '')
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)])
  for (let j = 0; j <= b.length; j++) dp[0][j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j - 1], dp[i - 1][j], dp[i][j - 1])
    }
  }
  return dp[a.length][b.length]
}

function matchByName<T extends { name: string }>(shapeName: string, candidates: T[]): T | undefined {
  const target = normalize(shapeName)
  if (target === '') return undefined

  const exact = candidates.find((c) => normalize(c.name) === target)
  if (exact) return exact

  const alias = ALIASES[shapeName.trim().toLowerCase()]
  if (alias) {
    const aliasTarget = normalize(alias)
    const aliasExact = candidates.find((c) => normalize(c.name) === aliasTarget)
    if (aliasExact) return aliasExact
  }

  const distTarget = alias ? normalize(alias) : target
  let best: T | undefined
  let bestDist = Infinity
  for (const c of candidates) {
    const dist = levenshtein(distTarget, normalize(c.name))
    if (dist < bestDist) {
      bestDist = dist
      best = c
    }
  }
  const tolerance = Math.max(2, Math.ceil(distTarget.length * 0.25))
  return best && bestDist <= tolerance ? best : undefined
}

/** Find the candidate whose name best matches `shapeName`. See the module
 *  doc comment for the match order. Returns undefined rather than a weak
 *  guess when nothing is close enough. */
export function matchDistrictName<T extends { name: string }>(shapeName: string, candidates: T[]): T | undefined {
  const direct = matchByName(shapeName, candidates)
  if (direct) return direct

  const parenMatch = shapeName.match(/^(.*?)\s*\(([^)]*)\)\s*$/)
  if (!parenMatch) return undefined
  const [, base, inner] = parenMatch
  return matchByName(base, candidates) ?? matchByName(inner, candidates)
}
