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
 *  SAMPLE DATA ONLY — NOT authoritative/complete. The official DoT National
 *  Numbering Plan 2003 (+ amendments) lists ~2,645 SDCAs nationwide; it
 *  could not be fetched in this environment (the DoT PDF 403s automated
 *  fetches) and no verified machine-readable alternative was found. This
 *  ships with a handful of illustrative entries only. Populating the full
 *  authoritative list is a follow-up data-entry task once the user supplies
 *  the official DoT source — see plan Decision #8. The lookup functions
 *  below degrade gracefully (return `undefined`/`[]`, never a wrong guess)
 *  for anything not yet in `STD_CODE_ENTRIES`. */

export interface StdCodeEntry {
  districtLgdCode: number
  city: string
  stdCode: string
}

export const STD_CODE_ENTRIES: StdCodeEntry[] = [
  // Khordha district, Odisha — the spec's own Bhubaneswar example. LGD
  // district code 386, confirmed against this repo's own bundled district
  // boundary data (src/assets/districts/21.json, Odisha's state file),
  // which lists { name: "Khordha", code: "386" } — NOT 375 (that code
  // belongs to Kendujhar in the same file).
  { districtLgdCode: 386, city: 'Bhubaneswar', stdCode: '0674' },
]

export function citiesForDistrict(districtLgdCode: number): StdCodeEntry[] {
  return STD_CODE_ENTRIES.filter((e) => e.districtLgdCode === districtLgdCode)
}

export function stdCodeForCity(districtLgdCode: number, city: string): string | undefined {
  return STD_CODE_ENTRIES.find((e) => e.districtLgdCode === districtLgdCode && e.city === city)?.stdCode
}
