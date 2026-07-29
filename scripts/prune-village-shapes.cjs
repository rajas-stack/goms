// Removes village-shape files the app can never load.
//
// Two kinds accumulate:
//  - Stale files written by the previous pipeline under sub-district codes that
//    belong to a different state (all 309 of Odisha's, for instance — see the
//    header of scripts/build-geo-from-lgd.cjs for why).
//  - "Extra" talukas that exist in the LGD source but have no node in
//    src/data/subdistricts.json, so no drill-down can reach them. These are
//    real places; they are listed in scripts/geo-build-report.json so the
//    hierarchy can be extended later, but until it is they are dead bundle
//    weight.
//
// A file is kept only when its code is a sub-district of the state whose
// directory it sits in — exactly the lookup village-shapes.ts performs.
//
// Run: node scripts/prune-village-shapes.cjs [--dry-run]
const fs = require('fs')
const path = require('path')

const ROOT = path.join(__dirname, '..')
const VILLAGE_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const dryRun = process.argv.includes('--dry-run')

const validByState = new Map()
for (const s of subdistricts) {
  const st = Number(s.stCode)
  ;(validByState.get(st) ?? validByState.set(st, new Set()).get(st)).add(String(Number(s.code)))
}

let kept = 0
let removed = 0
let bytesFreed = 0

for (const dir of fs.readdirSync(VILLAGE_DIR)) {
  const stateCode = Number(dir)
  const valid = validByState.get(stateCode) ?? new Set()
  const full = path.join(VILLAGE_DIR, dir)
  let k = 0
  let r = 0
  for (const file of fs.readdirSync(full)) {
    const code = String(Number(file.replace(/\.json$/, '')))
    if (valid.has(code)) { k++; continue }
    const p = path.join(full, file)
    bytesFreed += fs.statSync(p).size
    if (!dryRun) fs.unlinkSync(p)
    r++
  }
  kept += k
  removed += r
  if (r) console.log(`  state ${dir.padStart(2)}: kept ${String(k).padStart(4)}, ${dryRun ? 'would remove' : 'removed'} ${r}`)
  // An emptied directory would make village-shapes.ts's glob match nothing for
  // that state anyway; drop it so the tree reflects real coverage.
  if (!dryRun && k === 0 && fs.readdirSync(full).length === 0) fs.rmdirSync(full)
}

console.log(
  `\nkept ${kept} village files, ${dryRun ? 'would remove' : 'removed'} ${removed} ` +
  `(${(bytesFreed / 1e6).toFixed(1)} MB)`,
)
