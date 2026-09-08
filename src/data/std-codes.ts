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
 *  `docs/superpowers/analysis/` for the full sourcing writeup, including
 *  the 2026-09-08 dataset audit for this expansion.
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
  state: string
  /** Official LGD name (matches src/data/india-admin.json spelling), which
   *  sometimes lags a real-world district rename (e.g. Aurangabad, MH). */
  district: string
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
  /** 'verified' = confirmed directly against an official DoT/TRAI source
   *  with no district-mapping judgment call. 'cross-walked' = the STD code
   *  itself comes from an official source, but assigning it to a
   *  districtLgdCode required a human geographic judgment call (e.g. a city
   *  that isn't its district's namesake). 'secondary' = sourced from 2+
   *  independent non-official public references agreeing with each other,
   *  no official-source citation. Never silently presented as more certain
   *  than this. */
  verificationLevel: 'verified' | 'cross-walked' | 'secondary'
  notes?: string
}

// Shared provenance string for every row cross-walked from the Wikipedia
// "Telephone numbers in India" table, which cites DoT's National Numbering
// Plan 2003 directly (dot.gov.in itself 403s automated fetches — see file
// header). Mapping each city to a districtLgdCode was done by hand against
// src/data/india-admin.json; full methodology and per-row audit notes are
// in docs/superpowers/analysis/2026-09-08-goms-item2-std-code-dataset-audit.md.
const DOT_2003_VIA_WIKIPEDIA =
  'DoT National Numbering Plan 2003 city→STD-code table, per en.wikipedia.org/wiki/Telephone_numbers_in_India ' +
  '(fetched 2026-09-07); districtLgdCode cross-walked by hand to src/data/india-admin.json.'

// Shared provenance for the 2026-09-08 state-capital batch: cross-checked
// against 2 independent secondary sources — an Antigravity-tool-generated
// STD-code reference saved to std_codes.md in this repo (which itself
// disagreed with the existing dataset on Kanpur/Lucknow, a confirmed error,
// so was never trusted alone), and the state/UT-capitals list at
// knowyourcountry.wordpress.com/2010/04/08/std-codes-of-stateut-capitals-of-india/.
// Only rows where both agreed were added.
const CAPITALS_CROSS_CHECK_2026_09_08 =
  'Cross-checked 2026-09-08 against 2 independent sources: std_codes.md (Antigravity-tool research saved in this repo) and ' +
  'knowyourcountry.wordpress.com/2010/04/08/std-codes-of-stateut-capitals-of-india/ (both agree); ' +
  'districtLgdCode cross-walked by hand to src/data/india-admin.json.'

export const STD_CODE_ENTRIES: StdCodeEntry[] = [
  // Khordha district, Odisha — the spec's own Bhubaneswar example. LGD
  // district code 386, confirmed against this repo's own bundled district
  // boundary data (src/assets/districts/21.json, Odisha's state file),
  // which lists { name: "Khordha", code: "386" } — NOT 375 (that code
  // belongs to Kendujhar in the same file). STD code 0674 cross-checked
  // against multiple independent public references (not an official-source
  // citation, hence 'secondary' rather than 'cross-walked') at the time
  // this dataset was written (2026-09-07) with no disagreement.
  {
    state: 'Odisha',
    district: 'Khordha',
    districtLgdCode: 386,
    city: 'Bhubaneswar',
    stdCode: '0674',
    source:
      "Cross-checked against multiple independent public references, 2026-09-07; district code confirmed against this repo's own src/assets/districts/21.json",
    verificationLevel: 'secondary',
  },

  // Andaman and Nicobar Islands
  { state: 'Andaman and Nicobar Islands', district: 'South Andaman', districtLgdCode: 640, city: 'Port Blair', stdCode: '03192', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Andhra Pradesh
  { state: 'Andhra Pradesh', district: 'Guntur', districtLgdCode: 548, city: 'Guntur', stdCode: '0863', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Andhra Pradesh', district: 'Krishna', districtLgdCode: 547, city: 'Vijayawada', stdCode: '0866', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Vijayawada city is the HQ of Krishna district, not a district of its own name.' },
  { state: 'Andhra Pradesh', district: 'Visakhapatnam', districtLgdCode: 544, city: 'Visakhapatnam', stdCode: '0891', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Arunachal Pradesh
  { state: 'Arunachal Pradesh', district: 'Papum Pare', districtLgdCode: 248, city: 'Itanagar', stdCode: '0360', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'Itanagar (state capital) is in Papum Pare district, not a district of its own name.' },

  // Assam
  { state: 'Assam', district: 'Kamrup Metropolitan', districtLgdCode: 322, city: 'Guwahati', stdCode: '0361', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: "Guwahati is in Kamrup Metropolitan district; Assam's official capital, Dispur, is a locality within Guwahati and shares this code." },

  // Bihar
  { state: 'Bihar', district: 'Patna', districtLgdCode: 230, city: 'Patna', stdCode: '0612', source: DOT_2003_VIA_WIKIPEDIA + ' Additionally cross-checked against the Govt-of-Bihar district site patna.nic.in/std-pin-codes, 2026-09-08.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Muzaffarpur', districtLgdCode: 216, city: 'Muzaffarpur', stdCode: '0621', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Wikipedia\'s table lists Muzaffarpur before Patna, an ordering that looked like a possible digit transposition against the well-known Patna=0612; re-verified 2026-09-08 via web search and an official Bihar govt source (patna.nic.in) — both codes as listed are correct, no transposition.' },
  { state: 'Bihar', district: 'Bhagalpur', districtLgdCode: 224, city: 'Bhagalpur', stdCode: '0641', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Chandigarh
  { state: 'Chandigarh', district: 'Chandigarh', districtLgdCode: 55, city: 'Chandigarh', stdCode: '0172', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Wikipedia lists this SDCA as the multi-state 'Chandigarh Capital Region' (spanning Chandigarh UT plus parts of Punjab's S.A.S. Nagar and Haryana's Panchkula districts) — mapped here only to the Chandigarh UT district; do not assume this row also covers Mohali/Panchkula addresses." },

  // Chhattisgarh
  { state: 'Chhattisgarh', district: 'Raipur', districtLgdCode: 410, city: 'Raipur', stdCode: '0771', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Dadra and Nagar Haveli and Daman and Diu
  { state: 'Dadra and Nagar Haveli and Daman and Diu', district: 'Daman', districtLgdCode: 495, city: 'Daman', stdCode: '0260', source: DOT_2003_VIA_WIKIPEDIA + " Re-checked 2026-09-08 after std_codes.md (Antigravity research) claimed 02875 for Daman instead — a second independent source (knowyourcountry.wordpress.com's capitals list) agrees with 0260, not 02875, so the original value stands; 02875 rejected.", verificationLevel: 'cross-walked' },

  // Delhi
  { state: 'Delhi', district: 'New Delhi', districtLgdCode: 94, city: 'New Delhi', stdCode: '011', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Goa
  { state: 'Goa', district: 'North Goa', districtLgdCode: 585, city: 'Panaji', stdCode: '0832', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Gujarat
  { state: 'Gujarat', district: 'Ahmedabad', districtLgdCode: 474, city: 'Ahmedabad', stdCode: '079', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Gujarat', district: 'Gandhinagar', districtLgdCode: 473, city: 'Gandhinagar', stdCode: '079', source: "Confirmed 2026-09-08 via the official Govt-of-Gujarat district site gandhinagar.nic.in/std-pin-codes/ (Gandhinagar Vidhan Sabha, STD Code 079); shares this code with neighboring Ahmedabad. std_codes.md (Antigravity research) claimed 02712 instead, but that code belongs to a different taluka within Gandhinagar district, not the city itself — rejected per the official source.", verificationLevel: 'verified' },
  { state: 'Gujarat', district: 'Surat', districtLgdCode: 492, city: 'Surat', stdCode: '0261', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Gujarat', district: 'Vadodara', districtLgdCode: 486, city: 'Vadodara', stdCode: '0265', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Haryana
  { state: 'Haryana', district: 'Gurugram', districtLgdCode: 86, city: 'Gurugram', stdCode: '0124', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Haryana', district: 'Faridabad', districtLgdCode: 88, city: 'Faridabad', stdCode: '0129', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Himachal Pradesh
  { state: 'Himachal Pradesh', district: 'Shimla', districtLgdCode: 33, city: 'Shimla', stdCode: '0177', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Jammu and Kashmir
  { state: 'Jammu and Kashmir', district: 'Jammu', districtLgdCode: 21, city: 'Jammu', stdCode: '0191', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Jammu and Kashmir', district: 'Srinagar', districtLgdCode: 10, city: 'Srinagar', stdCode: '0194', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Jharkhand
  { state: 'Jharkhand', district: 'East Singhbhum', districtLgdCode: 357, city: 'Jamshedpur', stdCode: '0657', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Jamshedpur is the HQ town of East Singhbhum district, not a district of its own name.' },
  { state: 'Jharkhand', district: 'Ranchi', districtLgdCode: 364, city: 'Ranchi', stdCode: '0651', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Karnataka
  { state: 'Karnataka', district: 'Bengaluru Urban', districtLgdCode: 572, city: 'Bengaluru', stdCode: '080', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Karnataka', district: 'Udupi', districtLgdCode: 569, city: 'Udupi', stdCode: '0820', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Karnataka', district: 'Mysuru', districtLgdCode: 577, city: 'Mysuru', stdCode: '0821', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Historically anglicized 'Mysore' (used by Wikipedia's table) — LGD's current official spelling is 'Mysuru'; a user typing 'Mysore' will not exact-match this row." },
  { state: 'Karnataka', district: 'Dakshina Kannada', districtLgdCode: 575, city: 'Mangaluru', stdCode: '0824', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Historically anglicized 'Mangalore' (used by Wikipedia's table); current official spelling is 'Mangaluru'. City is the HQ of Dakshina Kannada district, not a district of its own name." },
  { state: 'Karnataka', district: 'Belagavi', districtLgdCode: 555, city: 'Belagavi', stdCode: '0831', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Historically anglicized 'Belgaum' (used by Wikipedia's table); current official spelling is 'Belagavi'." },
  { state: 'Karnataka', district: 'Dharwad', districtLgdCode: 562, city: 'Hubballi-Dharwad', stdCode: '0836', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Wikipedia lists this as the twin-city SDCA 'Hubli-Dharwad'; current official spelling is 'Hubballi-Dharwad'. Both towns are in Dharwad district." },

  // Kerala
  { state: 'Kerala', district: 'Pathanamthitta', districtLgdCode: 599, city: 'Thiruvalla', stdCode: '0469', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Thiruvananthapuram', districtLgdCode: 601, city: 'Thiruvananthapuram', stdCode: '0471', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Kollam', districtLgdCode: 600, city: 'Kollam', stdCode: '0474', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Alappuzha', districtLgdCode: 598, city: 'Alappuzha', stdCode: '0477', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Alappuzha', districtLgdCode: 598, city: 'Cherthala', stdCode: '0478', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Second SDCA within Alappuzha district, distinct from the Alappuzha-town row above.' },
  { state: 'Kerala', district: 'Kottayam', districtLgdCode: 597, city: 'Kottayam', stdCode: '0481', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Malappuram', districtLgdCode: 592, city: 'Malappuram', stdCode: '0483', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Ernakulam', districtLgdCode: 595, city: 'Kochi', stdCode: '0484', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Kochi is the major city of Ernakulam district, not a district of its own name.' },
  { state: 'Kerala', district: 'Ernakulam', districtLgdCode: 595, city: 'Muvattupuzha', stdCode: '0485', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Second SDCA within Ernakulam district, distinct from the Kochi row above.' },
  { state: 'Kerala', district: 'Pathanamthitta', districtLgdCode: 599, city: 'Pathanamthitta', stdCode: '0486', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Second SDCA within Pathanamthitta district, distinct from the Thiruvalla row above.' },
  { state: 'Kerala', district: 'Thrissur', districtLgdCode: 594, city: 'Thrissur', stdCode: '0487', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Kannur', districtLgdCode: 589, city: 'Thalassery', stdCode: '0490', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Thalassery is a town within Kannur district, distinct from the Kannur-town row below.' },
  { state: 'Kerala', district: 'Kozhikode', districtLgdCode: 591, city: 'Kozhikode', stdCode: '0495', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Kerala', district: 'Kannur', districtLgdCode: 589, city: 'Kannur', stdCode: '0497', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Second SDCA within Kannur district, distinct from the Thalassery row above.' },

  // Lakshadweep
  { state: 'Lakshadweep', district: 'Lakshadweep', districtLgdCode: 587, city: 'Kavaratti', stdCode: '04896', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Madhya Pradesh
  { state: 'Madhya Pradesh', district: 'Gwalior', districtLgdCode: 421, city: 'Gwalior', stdCode: '0751', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Madhya Pradesh', district: 'Jabalpur', districtLgdCode: 451, city: 'Jabalpur', stdCode: '0761', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Madhya Pradesh', district: 'Bhopal', districtLgdCode: 444, city: 'Bhopal', stdCode: '0755', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Maharashtra
  { state: 'Maharashtra', district: 'Mumbai', districtLgdCode: 519, city: 'Mumbai', stdCode: '022', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Pune', districtLgdCode: 521, city: 'Pune', stdCode: '020', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Sangli', districtLgdCode: 531, city: 'Sangli', stdCode: '0233', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Aurangabad', districtLgdCode: 515, city: 'Aurangabad', stdCode: '0240', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Renamed Chhatrapati Sambhajinagar in 2023; india-admin.json's LGD snapshot still uses 'Aurangabad', so that spelling is used here per the crosswalk rule." },
  { state: 'Maharashtra', district: 'Ahmednagar', districtLgdCode: 522, city: 'Ahmednagar', stdCode: '0241', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: "Renamed Ahilyanagar in 2023; india-admin.json's LGD snapshot still uses 'Ahmednagar', so that spelling is used here per the crosswalk rule." },
  { state: 'Maharashtra', district: 'Palghar', districtLgdCode: 732, city: 'Vasai-Virar', stdCode: '0250', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Vasai-Virar Municipal Corporation is in Palghar district (split from Thane in 2014), not a district of its own name.' },
  { state: 'Maharashtra', district: 'Thane', districtLgdCode: 517, city: 'Kalyan-Dombivli', stdCode: '0251', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Kalyan-Dombivli is a twin-city municipal corporation within Thane district.' },
  { state: 'Maharashtra', district: 'Nashik', districtLgdCode: 516, city: 'Nashik', stdCode: '0253', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Jalgaon', districtLgdCode: 499, city: 'Jalgaon', stdCode: '0257', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Nagpur', districtLgdCode: 505, city: 'Nagpur', stdCode: '0712', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Amravati', districtLgdCode: 503, city: 'Amravati', stdCode: '0721', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Maharashtra', district: 'Akola', districtLgdCode: 501, city: 'Akola', stdCode: '0724', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Manipur
  { state: 'Manipur', district: 'Imphal West', districtLgdCode: 277, city: 'Imphal', stdCode: '0385', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'Imphal (state capital) straddles both Imphal West and Imphal East districts (split from a single undivided Imphal district); this code is added under both, see the Imphal East row below too.' },
  { state: 'Manipur', district: 'Imphal East', districtLgdCode: 278, city: 'Imphal', stdCode: '0385', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'Same city/code as the Imphal West row above; Imphal spans both districts.' },

  // Meghalaya
  { state: 'Meghalaya', district: 'East Khasi Hills', districtLgdCode: 298, city: 'Shillong', stdCode: '0364', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'Shillong (state capital) is in East Khasi Hills district, not a district of its own name.' },

  // Mizoram
  { state: 'Mizoram', district: 'Aizawl', districtLgdCode: 2005, city: 'Aizawl', stdCode: '0389', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'One source also listed an alternate code 03838 for a second Aizawl exchange; 0389 is the code both cross-checked sources agree is primary.' },

  // Nagaland
  { state: 'Nagaland', district: 'Kohima', districtLgdCode: 270, city: 'Kohima', stdCode: '0370', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Puducherry
  { state: 'Puducherry', district: 'Puducherry', districtLgdCode: 635, city: 'Puducherry', stdCode: '0413', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Punjab
  { state: 'Punjab', district: 'S.A.S. Nagar', districtLgdCode: 52, city: 'Kharar', stdCode: '0160', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Kharar town is in S.A.S. Nagar (Mohali) district, not a district of its own name.' },
  { state: 'Punjab', district: 'Ludhiana', districtLgdCode: 41, city: 'Ludhiana', stdCode: '0161', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Punjab', district: 'Patiala', districtLgdCode: 48, city: 'Patiala', stdCode: '0175', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Punjab', district: 'Jalandhar', districtLgdCode: 37, city: 'Jalandhar', stdCode: '0181', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Punjab', district: 'Amritsar', districtLgdCode: 49, city: 'Amritsar', stdCode: '0183', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Rajasthan
  { state: 'Rajasthan', district: 'Jaipur', districtLgdCode: 110, city: 'Jaipur', stdCode: '0141', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Sikkim
  { state: 'Sikkim', district: 'Gangtok', districtLgdCode: 244, city: 'Gangtok', stdCode: '03592', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary' },

  // Tamil Nadu
  { state: 'Tamil Nadu', district: 'Chennai', districtLgdCode: 603, city: 'Chennai', stdCode: '044', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Tamil Nadu', district: 'Coimbatore', districtLgdCode: 632, city: 'Coimbatore', stdCode: '0422', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Tamil Nadu', district: 'Tiruchirappalli', districtLgdCode: 614, city: 'Tiruchirappalli', stdCode: '0431', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Tamil Nadu', district: 'Thanjavur', districtLgdCode: 620, city: 'Kumbakonam', stdCode: '0435', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Kumbakonam is a town within Thanjavur district, not a district of its own name.' },
  { state: 'Tamil Nadu', district: 'Madurai', districtLgdCode: 623, city: 'Madurai', stdCode: '0452', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Tamil Nadu', district: 'Tirunelveli', districtLgdCode: 628, city: 'Tirunelveli', stdCode: '0462', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Telangana
  { state: 'Telangana', district: 'Hyderabad', districtLgdCode: 536, city: 'Hyderabad', stdCode: '040', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Telangana', district: 'Warangal Urban', districtLgdCode: 540, city: 'Warangal', stdCode: '0870', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Post-2016 district reorganization split Warangal into Warangal Urban and Warangal Rural; the city itself is in Warangal Urban.' },

  // Tripura
  { state: 'Tripura', district: 'West Tripura', districtLgdCode: 289, city: 'Agartala', stdCode: '0381', source: CAPITALS_CROSS_CHECK_2026_09_08, verificationLevel: 'secondary', notes: 'Agartala (state capital) is in West Tripura district, not a district of its own name.' },

  // Uttar Pradesh
  { state: 'Uttar Pradesh', district: 'Ghaziabad', districtLgdCode: 140, city: 'Ghaziabad', stdCode: '0120', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Wikipedia lists Ghaziabad and Noida together under one shared SDCA code; split here into two rows, one per district.' },
  { state: 'Uttar Pradesh', district: 'Gautam Buddha Nagar', districtLgdCode: 141, city: 'Noida', stdCode: '0120', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Shares SDCA code 0120 with Ghaziabad (see that row); Noida is the HQ town of Gautam Buddha Nagar district, not a district of its own name.' },
  { state: 'Uttar Pradesh', district: 'Kanpur Nagar', districtLgdCode: 164, city: 'Kanpur', stdCode: '0512', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Lucknow', districtLgdCode: 157, city: 'Lucknow', stdCode: '0522', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Prayagraj', districtLgdCode: 175, city: 'Prayagraj', stdCode: '0532', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Varanasi', districtLgdCode: 197, city: 'Varanasi', stdCode: '0542', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Gorakhpur', districtLgdCode: 188, city: 'Gorakhpur', stdCode: '0551', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Agra', districtLgdCode: 146, city: 'Agra', stdCode: '0562', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Bareilly', districtLgdCode: 150, city: 'Bareilly', stdCode: '0581', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'Uttar Pradesh', district: 'Moradabad', districtLgdCode: 135, city: 'Moradabad', stdCode: '0591', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // Uttarakhand
  { state: 'Uttarakhand', district: 'Dehradun', districtLgdCode: 60, city: 'Dehradun', stdCode: '0135', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },

  // West Bengal
  { state: 'West Bengal', district: 'Kolkata', districtLgdCode: 342, city: 'Kolkata', stdCode: '033', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked' },
  { state: 'West Bengal', district: 'Paschim Bardhaman', districtLgdCode: 777, city: 'Durgapur', stdCode: '0343', source: DOT_2003_VIA_WIKIPEDIA, verificationLevel: 'cross-walked', notes: 'Durgapur is in Paschim Bardhaman district (split from Bardhaman in 2017), not a district of its own name.' },

  // 2026-09-08 batch 3: merged from user-supplied top_150_important_verified_indian_cities_std_codes_2026-09-08.csv
  // Every row below cites an official/regulatory source (RBI Ombudsman listings, SEBI-hosted
  // official documents, district .gov.in/.nic.in STD-PIN pages, or the Bihar State Tourism
  // Development Corporation official STD-code table at bstdc.bihar.gov.in/std_code.htm).
  // verificationLevel is 'verified' where the CSV's own district/area column named the
  // LGD district directly; 'cross-walked' for the Bihar sub-divisional towns, where the
  // source table listed a town name only and the districtLgdCode required a manual
  // geographic-knowledge judgment call (Bihar district boundaries), not given by the source.
  { state: 'Madhya Pradesh', district: 'Indore', districtLgdCode: 439, city: 'Indore', stdCode: '0731', source: 'SEBI-hosted official document (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official regulator-hosted address/STD listing' },
  { state: 'Bihar', district: 'Aurangabad', districtLgdCode: 235, city: 'Aurangabad', stdCode: '06186', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'Directly listed by Bihar State Tourism Development Corporation.' },
  { state: 'Maharashtra', district: 'Nanded', districtLgdCode: 511, city: 'Nanded', stdCode: '02462', source: 'Official source: https://nanded.gov.in/en/std-pin-codes/ (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified' },
  { state: 'Maharashtra', district: 'Palghar', districtLgdCode: 732, city: 'Vasai', stdCode: '0250', source: 'Official source: https://palghar.gov.in/en/std-pin-codes/ (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified' },
  { state: 'Maharashtra', district: 'Palghar', districtLgdCode: 732, city: 'Palghar', stdCode: '02525', source: 'Official source: https://palghar.gov.in/en/std-pin-codes/ (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified' },
  { state: 'Rajasthan', district: 'Kota', districtLgdCode: 127, city: 'Kota', stdCode: '0744', source: 'Government of Rajasthan (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official department contact listing' },
  { state: 'Rajasthan', district: 'Jodhpur', districtLgdCode: 113, city: 'Jodhpur', stdCode: '0291', source: 'Government of Rajasthan (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official department contact listing' },
  { state: 'Rajasthan', district: 'Udaipur', districtLgdCode: 130, city: 'Udaipur', stdCode: '0294', source: 'Government of Rajasthan (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official department contact listing' },
  { state: 'Rajasthan', district: 'Ajmer', districtLgdCode: 119, city: 'Ajmer', stdCode: '0145', source: 'SEBI-hosted official 2025 document (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official regulator-hosted address/STD listing' },
  { state: 'Rajasthan', district: 'Bikaner', districtLgdCode: 101, city: 'Bikaner', stdCode: '0151', source: 'Government of Rajasthan (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official department contact listing' },
  { state: 'Jharkhand', district: 'Dhanbad', districtLgdCode: 354, city: 'Dhanbad', stdCode: '0326', source: 'SEBI-hosted official 2025 document (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Official regulator-hosted address/STD listing' },
  { state: 'West Bengal', district: 'Darjeeling', districtLgdCode: 327, city: 'Siliguri', stdCode: '0353', source: 'Official source: https://darjeeling.gov.in/std-pin-codes/ (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified' },
  { state: 'Odisha', district: 'Cuttack', districtLgdCode: 381, city: 'Cuttack', stdCode: '0671', source: 'Official source: https://www.rd.odisha.gov.in/en/citizen-services/std-code (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Directly shown in the Government of Odisha STD-code table.' },
  { state: 'Odisha', district: 'Balasore', districtLgdCode: 377, city: 'Balasore', stdCode: '06782', source: 'Official source: https://www.rd.odisha.gov.in/en/citizen-services/std-code (user-supplied CSV, 2026-09-08).', verificationLevel: 'verified', notes: 'Directly shown in the Government of Odisha STD-code table.' },
  { state: 'Bihar', district: 'Kaimur', districtLgdCode: 233, city: 'Adhaura', stdCode: '06180', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Banka', districtLgdCode: 225, city: 'Amarpur', stdCode: '06420', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Araria', districtLgdCode: 209, city: 'Araria', stdCode: '06453', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Areraj', stdCode: '06258', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Bhojpur', districtLgdCode: 231, city: 'Arrah', stdCode: '06182', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Arwal', districtLgdCode: 240, city: 'Arwal', stdCode: '06337', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'West Champaran', districtLgdCode: 203, city: 'Bagaha', stdCode: '06251', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Banka', districtLgdCode: 225, city: 'Banka', stdCode: '06424', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Purnia', districtLgdCode: 211, city: 'Banmankhi', stdCode: '06467', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Barachakia', stdCode: '06257', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Begusarai', districtLgdCode: 222, city: 'Barauni', stdCode: '06279', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Patna', districtLgdCode: 230, city: 'Barh', stdCode: '06132', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Katihar', districtLgdCode: 212, city: 'Barsoi', stdCode: '06451', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'CSV spelled this \'Barosi\'.' },
  { state: 'Bihar', district: 'Begusarai', districtLgdCode: 222, city: 'Begusarai', stdCode: '06243', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Madhubani', districtLgdCode: 207, city: 'Benipatti', stdCode: '06271', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Darbhanga', districtLgdCode: 215, city: 'Benipur', stdCode: '06242', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'West Champaran', districtLgdCode: 203, city: 'Bettiah', stdCode: '06254', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Kaimur', districtLgdCode: 233, city: 'Bhabhua', stdCode: '06189', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Vaishali', districtLgdCode: 220, city: 'Bidupur', stdCode: '06229', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Nalanda', districtLgdCode: 229, city: 'Biharsharif', stdCode: '06112', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Patna', districtLgdCode: 230, city: 'Bikram', stdCode: '06135', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Rohtas', districtLgdCode: 234, city: 'Bikramganj', stdCode: '06185', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Supaul', districtLgdCode: 208, city: 'Birpur', stdCode: '06471', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Buxar', districtLgdCode: 232, city: 'Buxer', stdCode: '06183', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'CSV spelled this \'Buxer\'.' },
  { state: 'Bihar', district: 'Jamui', districtLgdCode: 238, city: 'Chakai', stdCode: '06347', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Samastipur', districtLgdCode: 221, city: 'Dalsinghsarai', stdCode: '06278', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Patna', districtLgdCode: 230, city: 'Danapur', stdCode: '06115', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Darbhanga', districtLgdCode: 215, city: 'Darbhanga', stdCode: '06272', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Aurangabad', districtLgdCode: 235, city: 'Daudnagar', stdCode: '06328', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Dhaka', stdCode: '06328', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Purnia', districtLgdCode: 211, city: 'Dhamdaha', stdCode: '06462', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Buxar', districtLgdCode: 232, city: 'Dumraon', stdCode: '06323', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Saran', districtLgdCode: 219, city: 'Ekma', stdCode: '06155', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Araria', districtLgdCode: 209, city: 'Forbesganj', stdCode: '06455', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Gaya', districtLgdCode: 236, city: 'Gaya', stdCode: '0631', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Khagaria', districtLgdCode: 223, city: 'Gogri', stdCode: '06245', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Gopalganj', districtLgdCode: 217, city: 'Gopalganj', stdCode: '06156', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Munger', districtLgdCode: 226, city: 'H.Kharagpur', stdCode: '06342', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'Kharagpur sub-division of Munger district (not the West Bengal city of the same name).' },
  { state: 'Bihar', district: 'Vaishali', districtLgdCode: 220, city: 'Hajipur', stdCode: '06224', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Gopalganj', districtLgdCode: 217, city: 'Hathua', stdCode: '06150', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Nalanda', districtLgdCode: 229, city: 'Hilsa', stdCode: '06111', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Gaya', districtLgdCode: 236, city: 'Imamganj', stdCode: '06331', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Jehanabad', districtLgdCode: 239, city: 'Jahanabad', stdCode: '06114', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town (district\'s LGD name is \'Jehanabad\').' },
  { state: 'Bihar', district: 'Jamui', districtLgdCode: 238, city: 'Jamui', stdCode: '06345', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Jamui', districtLgdCode: 238, city: 'Jhajha', stdCode: '06349', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Madhubani', districtLgdCode: 207, city: 'Jhanjharpur', stdCode: '06273', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Bhagalpur', districtLgdCode: 224, city: 'Kahalgaon', stdCode: '06429', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Katihar', districtLgdCode: 212, city: 'Katihar', stdCode: '06452', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Banka', districtLgdCode: 225, city: 'Katoria', stdCode: '06425', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Khagaria', districtLgdCode: 223, city: 'Khagaria', stdCode: '06244', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Kishanganj', districtLgdCode: 210, city: 'Kishanganj', stdCode: '06466', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Katihar', districtLgdCode: 212, city: 'Korha', stdCode: '06457', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Lakhisarai', districtLgdCode: 227, city: 'Lakhisarai', stdCode: '06346', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Madhepura', districtLgdCode: 213, city: 'Madhepura', stdCode: '06476', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Madhubani', districtLgdCode: 207, city: 'Madhubani', stdCode: '06276', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Siwan', districtLgdCode: 218, city: 'Maharajganj', stdCode: '06153', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Vaishali', districtLgdCode: 220, city: 'Mahua', stdCode: '06227', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Siwan', districtLgdCode: 218, city: 'Mairwa', stdCode: '06157', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Saran', districtLgdCode: 219, city: 'Masrakh', stdCode: '06159', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Kaimur', districtLgdCode: 233, city: 'Mohania', stdCode: '06187', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Munger', districtLgdCode: 226, city: 'Monghyr', stdCode: '06344', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'Old spelling of Munger district\'s own namesake town.' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Motihari', stdCode: '06252', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Muzaffarpur', districtLgdCode: 216, city: 'Motipur', stdCode: '06223', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Aurangabad', districtLgdCode: 235, city: 'Nabinagar', stdCode: '06332', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'West Champaran', districtLgdCode: 203, city: 'Narkatiaganj', stdCode: '06253', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Bhagalpur', districtLgdCode: 224, city: 'Naugachia', stdCode: '06421', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Nawada', districtLgdCode: 237, city: 'Nawada', stdCode: '06324', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Jamui', districtLgdCode: 238, city: 'Pakribarwan', stdCode: '06325', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Pakridayal', stdCode: '06259', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Madhubani', districtLgdCode: 207, city: 'Phulparas', stdCode: '06277', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Bhojpur', districtLgdCode: 231, city: 'Piro', stdCode: '06181', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Sitamarhi', districtLgdCode: 206, city: 'Pupri', stdCode: '06228', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Purnia', districtLgdCode: 211, city: 'Purnia', stdCode: '06454', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'CSV spelled this \'Purena\'; code matches the well-established Purnia=06454.' },
  { state: 'Bihar', district: 'Aurangabad', districtLgdCode: 235, city: 'Rafiganj', stdCode: '06327', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Nawada', districtLgdCode: 237, city: 'Rajauli', stdCode: '06336', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'West Champaran', districtLgdCode: 203, city: 'Ramnagar', stdCode: '06256', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Araria', districtLgdCode: 209, city: 'Raniganj', stdCode: '06461', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'Bihar/Araria Raniganj, distinct from the West Bengal town of the same name.' },
  { state: 'Bihar', district: 'East Champaran', districtLgdCode: 204, city: 'Raxaul', stdCode: '06255', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Rohtas', districtLgdCode: 234, city: 'Rohtas', stdCode: '06188', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Samastipur', districtLgdCode: 221, city: 'Rosera', stdCode: '06275', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Patna', districtLgdCode: 230, city: 'S.Bakhtiarpur', stdCode: '06475', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Saharsa', districtLgdCode: 214, city: 'Saharsa', stdCode: '06478', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Samastipur', districtLgdCode: 221, city: 'Samastipur', stdCode: '06274', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Rohtas', districtLgdCode: 234, city: 'Sasaram', stdCode: '06184', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked', notes: 'District HQ town.' },
  { state: 'Bihar', district: 'Sheikhpura', districtLgdCode: 228, city: 'Seikhpura', stdCode: '06341', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Sheohar', districtLgdCode: 205, city: 'Sheohar', stdCode: '06222', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Gaya', districtLgdCode: 236, city: 'Sherghati', stdCode: '06326', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Gopalganj', districtLgdCode: 217, city: 'Sidhawalia', stdCode: '06151', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Darbhanga', districtLgdCode: 215, city: 'Singhwara', stdCode: '06247', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Sitamarhi', districtLgdCode: 206, city: 'Sitamarhi', stdCode: '06226', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
  { state: 'Bihar', district: 'Siwan', districtLgdCode: 218, city: 'Siwan', stdCode: '06154', source: 'Bihar State Tourism Development Corporation official STD-code table, https://bstdc.bihar.gov.in/std_code.htm (user-supplied CSV, 2026-09-08); districtLgdCode assigned by hand -- the source lists towns, not districts.', verificationLevel: 'cross-walked' },
]

export function citiesForDistrict(districtLgdCode: number): StdCodeEntry[] {
  return STD_CODE_ENTRIES.filter((e) => e.districtLgdCode === districtLgdCode)
}

export function stdCodeForCity(districtLgdCode: number, city: string): string | undefined {
  return STD_CODE_ENTRIES.find((e) => e.districtLgdCode === districtLgdCode && e.city === city)?.stdCode
}
