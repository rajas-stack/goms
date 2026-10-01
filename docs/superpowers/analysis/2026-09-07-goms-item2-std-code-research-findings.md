# GOMS Item 2 — STD Code Dataset: Research Findings (stopped mid-task)

**Date:** 2026-09-07
**Status:** Research only. Interrupted by user before any merge/implementation. `src/data/std-codes.ts` was NOT modified — it still has exactly 1 entry (Khordha/Bhubaneswar, 0674). Nothing was written to goms-dev or goms-prod.

This file exists so the next session doesn't have to re-derive the ground-truth sources found here. **The 6 background research agents dispatched to gather district-level STD codes from secondary sources were killed before their results were retrieved — that data is gone and would need to be re-gathered from scratch if wanted.** Everything below is what survived: things fetched directly in the main session, and things already in the repo.

---

## 1. Current state

- `src/data/std-codes.ts` — schema (`StdCodeEntry`: `districtLgdCode`, `city`, `sdcaName?`, `stdCode`, `source`, `verified: boolean`) and lookup functions (`citiesForDistrict`, `stdCodeForCity`) are already built and working. Only 1 seed entry exists: Khordha district (LGD code 386) → Bhubaneswar → `0674`.
- UI wiring (`src/features/nodes/DepartmentFields.tsx`) already consumes this lookup correctly: State→District pick resolves a `districtLgdCode`, city free-text auto-fills STD code only on an exact seed match, otherwise stays editable. **No UI/business-logic change is needed to expand the dataset** — appending rows to `STD_CODE_ENTRIES` is sufficient.
- All other 14 items in the Sept-1 15-item enhancement plan already have implementation artifacts in the codebase (confirmed via grep: `Avatar.tsx`, `assignOwnerFromEmail.ts`, `updatePostingManager`, `AttendeeRef`, `nextSteps`, etc.) — Item 2's dataset is the only genuinely open item from that plan.

## 2. Ground-truth source #1 — LGD district code list (already in repo)

`src/data/india-admin.json` is the authoritative state+district+`dt_code` list already used by the app's own hierarchy tree. **This is the correct crosswalk target for `StdCodeEntry.districtLgdCode`** — it is NOT the same numbering as the bundled district boundary GeoJSON files (`src/assets/districts/*.json`), which use a different code scheme and join by name via `src/features/geography/district-match.ts` (with its own alias table for renamed districts — reuse that alias table if district-name matching is needed again, e.g. Bijapur→Vijayapura, Allahabad→Prayagraj, Gurgaon→Gurugram, etc.).

`india-admin.json` contains all 36 states/UTs with every current district's official name and LGD `dt_code`, e.g.:
```json
{"st_code":"21","st_nm":"Odisha","districts":[...,{"dt_code":"386","district":"Khordha"},...]}
```
This confirms the existing seed entry's `districtLgdCode: 386` is correct.

## 3. Ground-truth source #2 — Wikipedia's DoT-sourced STD code table (fetched verbatim, 2026-09-07)

`https://en.wikipedia.org/wiki/Telephone_numbers_in_India` carries a city→STD-code table explicitly cited to **DoT's National Numbering Plan 2003** (official source URL given on the page: `http://www.dot.gov.in/national-numbering-plan-list`, last updated per the page as 13 April 2015). This is Tier-1-caliber (official-numbering-plan-sourced), reasonable to use as a verified anchor set once cross-walked to `districtLgdCode` via `india-admin.json`. Full list as fetched (leading zeros restored — Wikipedia's own rendering dropped them, so **re-verify each leading zero against a second source before treating any single one as certain**, but the digit sequence itself is DoT-sourced):

```
New Delhi, Delhi: 011
Mumbai, Maharashtra: 022
Kolkata, West Bengal: 033
Chennai, Tamil Nadu: 044
Pune, Maharashtra: 020
Hyderabad, Telangana: 040
Ahmedabad, Gujarat: 079
Bengaluru, Karnataka: 080
Ghaziabad and Noida, Uttar Pradesh: 0120
Gurugram, Haryana: 0124
Faridabad, Haryana: 0129
Dehradun, Uttarakhand: 0135
Jaipur, Rajasthan: 0141
Kharar, Punjab: 0160
Ludhiana, Punjab: 0161
Chandigarh Capital Region, Chandigarh/Punjab/Haryana: 0172
Patiala, Punjab: 0175
Jalandhar, Punjab: 0181
Amritsar, Punjab: 0183
Jammu, Jammu & Kashmir: 0191
Srinagar, Jammu & Kashmir: 0194
Sangli, Maharashtra: 0233
Aurangabad, Maharashtra: 0240
Ahmednagar, Maharashtra: 0241
Vasai-Virar, Maharashtra: 0250
Kalyan-Dombivli, Maharashtra: 0251
Nashik, Maharashtra: 0253
Jalgaon, Maharashtra: 0257
Daman, Dadra and Nagar Haveli and Daman and Diu: 0260
Surat, Gujarat: 0261
Vadodara, Gujarat: 0265
Durgapur, West Bengal: 0343
Puducherry, Puducherry: 0413
Coimbatore, Tamil Nadu: 0422
Tiruchirappalli, Tamil Nadu: 0431
Kumbakonam, Tamil Nadu: 0435
Madurai, Tamil Nadu: 0452
Tirunelveli, Tamil Nadu: 0462
Thiruvalla, Pathanamthitta District, Kerala: 0469
Thiruvananthapuram, Kerala: 0471
Kollam, Kerala: 0474
Alappuzha, Kerala: 0477
Cherthala, Alappuzha District, Kerala: 0478
Kottayam, Kerala: 0481
Malappuram, Kerala: 0483
Kochi, Kerala: 0484
Muvattupuzha, Ernakulam District, Kerala: 0485
Pathanamthitta, Kerala: 0486
Thrissur, Kerala: 0487
Thalassery, Kannur District, Kerala: 0490
Kozhikode, Kerala: 0495
Kannur, Kerala: 0497
Kanpur, Uttar Pradesh: 0512
Lucknow, Uttar Pradesh: 0522
Prayagraj, Uttar Pradesh: 0532
Varanasi, Uttar Pradesh: 0542
Gorakhpur, Uttar Pradesh: 0551
Agra, Uttar Pradesh: 0562
Bareilly, Uttar Pradesh: 0581
Moradabad, Uttar Pradesh: 0591
Muzaffarpur, Bihar: 0621
Patna, Bihar: 0612
Bhagalpur, Bihar: 0641
Jamshedpur, Jharkhand (East Singhbhum district): 0657
Nagpur, Maharashtra: 0712
Amravati, Maharashtra: 0721
Akola, Maharashtra: 0724
Gwalior, Madhya Pradesh: 0751
Jabalpur, Madhya Pradesh: 0761
Udupi, Karnataka: 0820
Mysore, Karnataka: 0821
Mangalore, Karnataka: 0824
Belgaum, Karnataka: 0831
Hubli-Dharwad, Karnataka: 0836
Guntur, Andhra Pradesh: 0863
Vijayawada, Andhra Pradesh (Krishna district): 0866
Warangal, Telangana: 0870
Visakhapatnam, Andhra Pradesh: 0891
Port Blair, South Andaman Island, Andaman and Nicobar Islands: 03192
Kavaratti, Lakshadweep: 04896
```

Notes on using this list:
- Patna and Muzaffarpur's ordering in the source table looked reversed relative to their digit count — double-check 0612 vs 0621 against a second source before entering (Patna is very widely known as 0612; flag this specific pair for cross-check).
- Several entries name a city that isn't itself a district (e.g. "Kharar" is in Mohali/S.A.S. Nagar district, Punjab; "Vijayawada" is Krishna district; "Jamshedpur" is East Singhbhum) — resolving to the right `districtLgdCode` requires that district-level knowledge, not a literal name match.
- This list only covers ~75 cities total — far short of the 150+/district-HQ-level coverage the user asked for. It's a solid anchor, not a finished dataset.

## 4. Secondary sources identified for future Tier-3 cross-checking (not yet fetched/verified — just located via search)

For any future pass, these directory sites were found and were the intended basis for cross-checked (2-source-agreement) Tier-3 entries. None of their actual content was retrieved before the task was stopped:
- https://www.findandtrace.com/findSTDarea.php
- https://www.coveringindia.com/en/std-codes
- https://www.mapsofindia.com/std/
- https://www.nativeplanet.com/std-codes/india/
- https://www.indyatour.com/directory/std-code
- https://bharatiyamobile.com/stdcodes/en

DoT's own PDF (dot.gov.in) is confirmed (per the existing code comment in `std-codes.ts`, from an earlier session) to 403 every automated fetch — not usable directly in this environment.

## 5. Schema decisions made (not yet implemented)

Per the user's spec, if/when this is resumed, `StdCodeEntry` should gain:
- `state: string`
- `district: string` (official LGD name, matching `india-admin.json` spelling)
- `verificationLevel: 'verified' | 'cross-walked' | 'secondary'` (replacing the current plain `verified: boolean`)
- `notes?: string`
- keep `districtLgdCode`, `city`, `sdcaName?`, `stdCode`, `source` as-is
- keep `citiesForDistrict`/`stdCodeForCity` function signatures unchanged (lookup API must not change)

A DATASET AUDIT (tier counts, states covered/missing, ambiguous SDCA→district mappings, conflicts found) was requested before writing the final array — not produced, since research was stopped first.

## 6. What actually needs to happen to resume this

1. Re-run (or manually do) the secondary-source cross-checking per state/district — the 6-agent dispatch used earlier is a reasonable pattern to repeat, but be aware each full pass costs meaningful tokens/time; consider scoping to fewer states per pass if budget is tight.
2. Cross-walk every gathered (city, STD code) pair to a `districtLgdCode` using `india-admin.json`, watching for HQ-town-≠-district-name cases (e.g. Khordha→Bhubaneswar, Kamrup Metropolitan→Guwahati, Gautam Buddha Nagar→Noida).
3. Merge with the Wikipedia Tier-1 list above (re-verify leading zeros/ordering per the Patna/Muzaffarpur caveat).
4. Produce the DATASET AUDIT, then write the expanded `STD_CODE_ENTRIES` array + updated tests (mapped and unmapped location cases).
