/** State→District→City/Town→STD-code reference data.
 *
 *  STD/NDC codes are assigned by India's Department of Telecommunications
 *  per SDCA (a town/city-level Short Distance Charging Area), not per
 *  district — a district routinely contains multiple SDCAs with different
 *  codes, so this is keyed by (districtLgdCode, city), not by district
 *  alone. `districtLgdCode` matches the same join key used by
 *  `district-shapes.ts`/`GeographyExplorer.tsx` (a district `HierNode`'s
 *  `code` field, parsed to a number).
 *
 *  PARTIAL COVERAGE — EXPANDABLE, NOT A COMPLETE NATIONAL TABLE. Researched
 *  2026-09-07: DoT's own National Numbering Plan 2003 (+ amendments) — the
 *  actual ~2,645-SDCA authority — 403s every automated fetch (4 distinct
 *  dot.gov.in URLs tried, all blocked; this is a blanket bot-block on the
 *  domain, not one broken link). TRAI doesn't publish the master SDCA→code
 *  list itself (only numbering-plan *policy* documents); its per-circle
 *  audit PDFs that reportedly list SDCA names are scanned/image-layer and
 *  not text-extractable. data.gov.in 403s entirely. No verified
 *  machine-readable mirror was found. Separately, SDCA (a telecom licensing
 *  unit, mostly taluka/tehsil-granularity per TRAI's own 2025 numbering-plan
 *  recommendation) and LGD district codes (a Ministry of Panchayati Raj
 *  administrative unit) are independently maintained hierarchies with no
 *  official crosswalk — mapping an SDCA to a district is a human geographic
 *  judgment call per row, not a mechanical join, and a "complete" table
 *  can't be built reliably in this environment. See
 *  `docs/superpowers/analysis/` for the full sourcing writeup.
 *
 *  Per explicit instruction: only manually-verified codes are added here —
 *  nothing scraped, guessed, or single-source. `citiesForDistrict`/
 *  `stdCodeForCity` degrade gracefully (`undefined`/`[]`, never a wrong
 *  guess) for anything not yet in `STD_CODE_ENTRIES`, and the UI leaves the
 *  STD field freely editable whenever they return nothing — never blocking
 *  or inserting a guessed value.
 *
 *  HOW TO EXPAND: append a new `StdCodeEntry` to the array below. No UI or
 *  business-logic change is ever required — `DepartmentFields.tsx`'s
 *  State→District→City flow and `stdCodeForCity`'s lookup both key
 *  automatically off whatever rows exist here. */

export interface StdCodeEntry {
  districtLgdCode: number
  /** The name shown in this app's own city/town free-text field. */
  city: string
  /** The official SDCA/exchange name, only when it differs from `city`
   *  (e.g. a taluka-level SDCA name that doesn't match the town people
   *  actually type) — omitted when `city` already is the SDCA name. */
  sdcaName?: string
  stdCode: string
  /** Where this row was cross-checked, for auditability — never left blank. */
  source: string
  /** `false` marks a row confirmed against only one source (kept anyway
   *  because it's still better than no auto-fill, but flagged so a future
   *  pass knows to double-check it before treating it as settled). */
  verified: boolean
}

export const STD_CODE_ENTRIES: StdCodeEntry[] = [
  // Khordha district, Odisha — the spec's own Bhubaneswar example. LGD
  // district code 386, confirmed against this repo's own bundled district
  // boundary data (src/assets/districts/21.json, Odisha's state file),
  // which lists { name: "Khordha", code: "386" } — NOT 375 (that code
  // belongs to Kendujhar in the same file). STD code 0674 cross-checked
  // against multiple independent public references at the time this dataset
  // was written (2026-09-07) with no disagreement.
  {
    districtLgdCode: 386,
    city: 'Bhubaneswar',
    stdCode: '0674',
    source: 'Cross-checked against multiple independent public references, 2026-09-07; district code confirmed against this repo\'s own src/assets/districts/21.json',
    verified: true,
  },
]

export function citiesForDistrict(districtLgdCode: number): StdCodeEntry[] {
  return STD_CODE_ENTRIES.filter((e) => e.districtLgdCode === districtLgdCode)
}

export function stdCodeForCity(districtLgdCode: number, city: string): string | undefined {
  return STD_CODE_ENTRIES.find((e) => e.districtLgdCode === districtLgdCode && e.city === city)?.stdCode
}
