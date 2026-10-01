# GOMS Item 2 — STD Code Dataset Audit

**Date:** 2026-09-08 (updated same day, second pass)
**Status:** Implemented. `src/data/std-codes.ts` now has **97 entries** covering **35 of 36 states/UTs** (only Ladakh has zero data anywhere). Tests updated and passing (10/10). Typecheck clean. goms-dev only — not touched in goms-prod.

## History this date

1. **First pass (morning):** merged the already-fetched ~80-entry Wikipedia/DoT National Numbering Plan 2003 table (82 entries total after merge, 24/36 states). Full details of that pass are unchanged from the original version of this doc — see the "Wikipedia/DoT merge" sections below.
2. **A large 8-parallel-agent nationwide research re-dispatch was started, then stopped by the user within ~3 minutes, before any agent produced results.** No data was gained or lost from that attempt — see [[project_goms_item2_std_code_dataset]] and [[feedback_large_research_batches_get_interrupted]] for what happened and why it shouldn't be repeated the same way.
3. **Second pass (same day, after the above):** the user had separately run research using another AI tool ("Antigravity"), saved as `std_codes.md` in the repo root — a 526-row, 35-state city→STD-code table with **no source citations**. Cross-checked it against the existing 82 entries (66 overlapping cities: 63 agreed, and 3 "conflicts" were found — 2 of those 3 were a false positive from naive city-only matching across different states, i.e. Aurangabad, Maharashtra vs. Aurangabad, Bihar, and 1 was Daman vs. Silvassa). **Found one confirmed hard error: `std_codes.md` has Kanpur and Lucknow's STD codes swapped** (it lists Kanpur=0522/Lucknow=0512; correct, well-established values are Kanpur=0512/Lucknow=0522, already in the dataset). This proves the file's own "verified" claim is false, so it was not merged wholesale. Instead, the user asked for a small bounded spot-check (no subagents) of the highest-value gap — state capitals not yet in the dataset — cross-checking `std_codes.md`'s claims against a second independent source before adding anything.

## What was added in the second pass (15 new rows, 14 new states covered)

All state/UT capitals not yet in the dataset were checked against a second independent list (`knowyourcountry.wordpress.com`'s state/UT-capitals STD-code page) in addition to `std_codes.md`; only rows where both agreed were added, all as `verificationLevel: 'secondary'` — except Gandhinagar, which was confirmed directly against an official government source and is `verified`.

| State | District | City | Code | Tier | Note |
|---|---|---|---|---|---|
| Arunachal Pradesh | Papum Pare | Itanagar | 0360 | secondary | |
| Assam | Kamrup Metropolitan | Guwahati | 0361 | secondary | |
| Chhattisgarh | Raipur | Raipur | 0771 | secondary | |
| Goa | North Goa | Panaji | 0832 | secondary | |
| Gujarat | Gandhinagar | Gandhinagar | 079 | **verified** | Confirmed via official gandhinagar.nic.in; `std_codes.md`'s claim of 02712 was wrong (that's a different taluka in the district) |
| Himachal Pradesh | Shimla | Shimla | 0177 | secondary | |
| Jharkhand | Ranchi | Ranchi | 0651 | secondary | |
| Madhya Pradesh | Bhopal | Bhopal | 0755 | secondary | |
| Manipur | Imphal West **and** Imphal East | Imphal | 0385 | secondary | Added under both districts — Imphal genuinely straddles both (split from one undivided district) |
| Meghalaya | East Khasi Hills | Shillong | 0364 | secondary | |
| Mizoram | Aizawl | Aizawl | 0389 | secondary | An alternate code 03838 appears in one source for a second exchange; 0389 is what both cross-checked sources agree is primary |
| Nagaland | Kohima | Kohima | 0370 | secondary | |
| Sikkim | Gangtok | Gangtok | 03592 | secondary | |
| Tripura | West Tripura | Agartala | 0381 | secondary | |

**Daman conflict resolved, not changed:** `std_codes.md` claimed Daman=02875 (contradicting the existing 0260 entry). Checked a second source, which agreed with the existing 0260 — so the existing entry stands; 02875 was rejected. The entry's `source` field now documents this resolved conflict.

## Updated tier counts (all 97 entries)

| Tier | Count | Meaning |
|---|---|---|
| `verified` | 1 | Gandhinagar — direct official-source (.nic.in) citation, unambiguous district match. |
| `cross-walked` | 82 | Official-sourced STD code (DoT 2003 via Wikipedia), district assignment required a manual crosswalk. |
| `secondary` | 14 | 2+ independent non-official sources agreeing (the 2026-09-08 capitals batch). |

*(The original Odisha/Bhubaneswar seed row is counted within `secondary`.)*

## States/UTs covered (35 of 36)

Every state/UT except **Ladakh** now has at least one entry. Ladakh has zero coverage because neither the Wikipedia DoT table nor `std_codes.md` nor the capitals cross-check source had any data for it — closing this last gap needs a fresh, targeted lookup (Leh/Kargil), not covered by anything already gathered.

## Density note

Density beyond "1-2 cities per state" still varies a lot and reflects what the underlying sources happened to cover, not deliberate prioritization — e.g. Maharashtra (12 cities), Kerala (10), Uttar Pradesh (10) are denser; most of the newly-added 14 states have exactly 1 (their capital). `std_codes.md` itself (526 rows) contains hundreds more candidate cities across every state that were **not** merged this pass — they weren't cross-checked against a second source and are not currently trustworthy on their own (per the confirmed Kanpur/Lucknow error). That file remains in the repo root as an unverified candidate-lead list for a future targeted pass, not as ground truth.

## Ambiguous mappings and conflicts (full list, includes first-pass items)

- **Imphal** (new, this pass) genuinely spans Imphal West and Imphal East districts — added under both rather than picking one arbitrarily.
- **Daman** (this pass) — `std_codes.md` disagreed with the existing entry; resolved in favor of the existing value (0260) after a second-source check, `notes`/`source` updated to record this.
- **Gandhinagar** (this pass) — `std_codes.md`'s 02712 turned out to be a different taluka's code, not the city's; resolved via an official source.
- **Chandigarh Capital Region** (SDCA 0172) genuinely spans three jurisdictions — mapped only to the Chandigarh UT district; notes say not to assume Mohali/Panchkula coverage.
- **Ghaziabad and Noida** shared one SDCA code (0120); split into two rows, one per district.
- Several first-pass rows name a city that is not its district's namesake: Vijayawada→Krishna, Jamshedpur→East Singhbhum, Kumbakonam→Thanjavur, Kochi & Muvattupuzha→Ernakulam, Vasai-Virar→Palghar, Kalyan-Dombivli→Thane, Durgapur→Paschim Bardhaman, Kharar→S.A.S. Nagar, Warangal→Warangal Urban, Mangaluru→Dakshina Kannada — each flagged in `notes`.
- Renames not yet reflected in india-admin.json's LGD snapshot: Aurangabad (→Chhatrapati Sambhajinagar), Ahmednagar (→Ahilyanagar), Mysuru (was "Mysore"), Belagavi (was "Belgaum"), Hubballi-Dharwad (was "Hubli-Dharwad").

## Conflicts found and how resolved

| City | Source A | Source B | Resolution |
|---|---|---|---|
| Kanpur / Lucknow | Existing dataset (DoT via Wikipedia): Kanpur=0512, Lucknow=0522 | `std_codes.md`: swapped | Existing values confirmed correct (also matches an official Bihar-style .nic.in-caliber cross-check pattern used for Patna); `std_codes.md` is wrong here — treated as a red flag against trusting that file uncorroborated elsewhere |
| Daman | Existing dataset: 0260 | `std_codes.md`: 02875 | A second source (capitals list) agreed with 0260; existing value kept |
| Gandhinagar | `std_codes.md`: 02712 | Official gandhinagar.nic.in: 079 | Official source wins; 02712 identified as a different taluka's code |

## What would come next (not done this pass, needs an explicit ask)

- Ladakh has zero data from any source gathered so far.
- `std_codes.md`'s ~460 non-overlapping rows remain unverified — a future pass could cross-check a further batch (non-capital major cities) the same way this pass did for capitals, but should stay bounded and be checked in with the user before scaling up, per [[feedback_large_research_batches_get_interrupted]].
- Full district-by-district density (per [[project_goms_item2_std_code_dataset]]) is still far from complete for most states.
