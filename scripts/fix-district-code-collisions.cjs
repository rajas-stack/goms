// One-off data repair: a handful of districts in src/data/india-admin.json
// carry dt_code values that collide with a DIFFERENT state's district (e.g.
// Mizoram's Aizawl and Nagaland's Mon both currently sit on 261). Any lookup
// keyed only by dt_code (without also scoping by state) silently resolves to
// whichever state was processed last, so the loser's district/talukas render
// as if they don't exist — not a boundary-geometry gap, a hierarchy-data bug.
//
// This is NOT about matching an external "real" LGD code: this app's
// hierarchy deliberately runs on an older LGD vintage (see the header of
// scripts/fill-gaps-from-national-lgd.cjs — "this dataset's dist_lgd/
// subdt_lgd are a different LGD vintage from the app's hierarchy"), so most
// of its codes intentionally don't match the current national LGD dataset;
// that's expected, not a bug. The only real bug is two districts in THIS
// app's own numbering sharing one value. The fix is simply to give the
// colliding side a fresh, never-used-anywhere code — which side doesn't
// matter for correctness, so the side with fewer dependent taluka rows is
// picked to minimize how much of subdistricts.json has to move.
//
// Fixes both src/data/india-admin.json (district dt_code) and
// src/data/subdistricts.json (taluka dtCode) in lockstep, scoped per state so
// a fix for one state's collision never touches another state's talukas that
// legitimately share the old numeric value.
//
// Run: node scripts/fix-district-code-collisions.cjs
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const ADMIN_PATH = path.join(ROOT, 'src', 'data', 'india-admin.json')
const SUBS_PATH = path.join(ROOT, 'src', 'data', 'subdistricts.json')

// { stateName: { districtName: newCode } } — the side of each collision with
// fewer dependent talukas (verified against subdistricts.json before writing
// this list), reassigned to a fresh code above the current max (996).
//
// Tamil Nadu's four newest districts (carved out after this app's LGD
// vintage snapshot -- Chengalpattu/Ranipet/Tenkasi/Tirupathur, all split off
// in 2019-2020) never got a real LGD dt_code at all; whatever originally
// built india-admin.json left all four on the placeholder '0' rather than
// resolving a real one. That's a same-state collision the cross-state fixes
// above never covered (this script's own name notwithstanding, a same-state
// 4-way collision is the same underlying bug, just missed the first pass) --
// found by a duplicate-node-id assertion the taluka id fix in src/data/
// seed.ts surfaced. None of the four has a real claim to '0', so all four
// get fresh codes rather than picking a "winner".
const FIXES = {
  Gujarat: { 'Gir Somnath': 2001, 'Vav-Tharad': 2002 },
  Sikkim: { Pakyong: 2003, Soreng: 2004 },
  Mizoram: {
    Aizawl: 2005, Champhai: 2006, Kolasib: 2007, Lawngtlai: 2008,
    Lunglei: 2009, Mamit: 2010, Saiha: 2011, Serchhip: 2012,
  },
  // A same-state collision can't be disambiguated by state+oldCode alone
  // (all four districts' talukas share both) -- these four give an explicit
  // taluka-name allowlist instead, verified against each district's real
  // taluk list and against subdistricts.json's own array order (the 26
  // talukas already sit in four contiguous, correctly-grouped blocks).
  'Tamil Nadu': {
    Chengalpattu: {
      code: 2013,
      talukas: ['Chengalpattu', 'Cheyyur', 'Maduranthakam', 'Pallavaram', 'Tambaram', 'Tirukalukundram', 'Tiruporur', 'Vandalur'],
    },
    Ranipet: {
      code: 2014,
      talukas: ['Arakonam', 'Arcot', 'Kalavai', 'Nemili', 'Sholinghur', 'Wallajah'],
    },
    Tenkasi: {
      code: 2015,
      talukas: ['Alangulam', 'Kadayanallur', 'Sankarankoil', 'Shenkottai', 'Sivagiri', 'Tenkasi', 'Tiruvengadam', 'Veerakeralamputhur'],
    },
    Tirupathur: {
      code: 2016,
      talukas: ['Ambur', 'Natrampalli', 'Tirupathur', 'Vaniyambadi'],
    },
  },
}

function main() {
  const admin = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'))
  let subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'))

  for (const [stateName, districtFixes] of Object.entries(FIXES)) {
    const state = admin.find((s) => s.st_nm === stateName)
    if (!state) { console.warn(`  ! state "${stateName}" not found`); continue }
    const stateCode = Number(state.st_code)

    for (const [districtName, fix] of Object.entries(districtFixes)) {
      const d = state.districts.find((x) => x.district === districtName)
      if (!d) { console.warn(`  ! ${stateName}/${districtName} not found`); continue }
      const oldCode = String(Number(d.dt_code))
      const talukaAllowlist = typeof fix === 'object' ? new Set(fix.talukas) : null
      const newCode = String(typeof fix === 'object' ? fix.code : fix)

      d.dt_code = newCode
      let retagged = 0
      subs = subs.map((s) => {
        if (Number(s.stCode) !== stateCode || String(Number(s.dtCode)) !== oldCode) return s
        // Same-state collisions (talukaAllowlist set) can't be told apart by
        // dtCode alone -- only retag the talukas verified to belong to this
        // district by name.
        if (talukaAllowlist && !talukaAllowlist.has(s.name)) return s
        retagged++
        return { ...s, dtCode: newCode }
      })
      console.log(`  ${stateName}/${districtName}: ${oldCode} -> ${newCode} (${retagged} taluka(s) retagged)`)
    }
  }

  fs.writeFileSync(ADMIN_PATH, JSON.stringify(admin))
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs))
  console.log('Patched india-admin.json and subdistricts.json.')
}

main()
