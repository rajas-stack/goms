// One-off data repair: three states shipped with only a stub admin hierarchy
// — Delhi (a single code-less "Delhi" district, zero talukas), Chandigarh and
// Sikkim (zero talukas). The Geography explorer drives its entire
// State→District→Taluka→Village drill-down from that hierarchy, so those
// states had nothing to open even though their district/taluka/village
// boundary geometry is bundled. This rebuilds their real districts +
// sub-districts from the authoritative LGD village shapefiles (the same zips
// scripts/generate-village-data.cjs reads) and patches them into
// india-admin.json and subdistricts.json.
//
// Codes are normalised exactly as generate-village-data.cjs normalises them
// (`String(Number(x))`), so sub-district `code`s line up with the
// village-shape directory names and the taluka boundary `code`s, and each
// sub-district's `dtCode` matches its district's `dt_code` after seed.ts's
// numeric coercion (dtKey uses Number()). Idempotent: re-running replaces the
// same three states cleanly.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync } = require('child_process')
const shapefile = require('shapefile')

const ROOT = path.join(__dirname, '..')
const ADMIN_PATH = path.join(ROOT, 'src', 'data', 'india-admin.json')
const SUBS_PATH = path.join(ROOT, 'src', 'data', 'subdistricts.json')

const TARGETS = [
  { zip: 'DELHI.zip', stateCode: 7 },
  { zip: 'CHANDIGARH.zip', stateCode: 4 },
  { zip: 'SIKKIM.zip', stateCode: 11 },
]

function prop(p, name) {
  const k = Object.keys(p).find((x) => x.toLowerCase() === name.toLowerCase())
  return k ? p[k] : undefined
}
function findOne(dir, re) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, e.name)
    if (e.isDirectory()) { const f = findOne(full, re); if (f) return f }
    else if (re.test(e.name)) return full
  }
  return null
}
// LGD shapefiles carry Delhi's names in ALL-CAPS but Chandigarh's and
// Sikkim's already properly cased — only re-case a string that has no
// lowercase at all, so already-correct names (and any "S.A.S."-style ones)
// are left untouched.
function niceName(s) {
  const t = String(s ?? '').trim()
  if (/[a-z]/.test(t)) return t
  return t.toLowerCase().replace(/\b([a-z])/g, (_, c) => c.toUpperCase())
}

async function extract(zip, stateCode) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hier-'))
  try {
    execFileSync('unzip', ['-oq', path.join(ROOT, zip), '-d', tmp])
    const shp = findOne(tmp, /\.shp$/i)
    const source = await shapefile.open(shp, shp.replace(/\.shp$/i, '.dbf'))
    const districts = new Map() // dtCode -> name
    const subs = new Map() // subCode -> { name, dtCode, villages:Set }
    let r = await source.read()
    while (!r.done) {
      const p = r.value.properties
      const dtCode = String(Number(prop(p, 'Dist_LGD')))
      const subCode = String(Number(prop(p, 'Subdis_LGD')))
      const villCode = String(Number(prop(p, 'Vill_LGD')))
      if (dtCode !== 'NaN') districts.set(dtCode, niceName(prop(p, 'District')))
      if (subCode !== 'NaN') {
        let s = subs.get(subCode)
        if (!s) { s = { name: niceName(prop(p, 'Sub_dist')), dtCode, villages: new Set() }; subs.set(subCode, s) }
        s.villages.add(villCode)
      }
      r = await source.read()
    }

    const districtList = [...districts.entries()]
      .map(([dt_code, district]) => ({ dt_code, district }))
      .sort((a, b) => a.district.localeCompare(b.district))
    const subList = [...subs.entries()]
      .map(([code, s]) => ({ code, name: s.name, dtCode: s.dtCode, stCode: stateCode, villageCount: s.villages.size }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return { districtList, subList }
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true })
  }
}

async function main() {
  const admin = JSON.parse(fs.readFileSync(ADMIN_PATH, 'utf8'))
  let subs = JSON.parse(fs.readFileSync(SUBS_PATH, 'utf8'))

  for (const { zip, stateCode } of TARGETS) {
    const { districtList, subList } = await extract(zip, stateCode)
    const state = admin.find((s) => Number(s.st_code) === stateCode)
    if (!state) { console.warn(`  ! state ${stateCode} not found in india-admin.json`); continue }
    state.districts = districtList
    subs = subs.filter((sd) => Number(sd.stCode) !== stateCode).concat(subList)
    console.log(`  ${state.st_nm}: ${districtList.length} districts, ${subList.length} talukas`)
  }

  // Match the existing files: minified, no trailing newline.
  fs.writeFileSync(ADMIN_PATH, JSON.stringify(admin))
  fs.writeFileSync(SUBS_PATH, JSON.stringify(subs))
  console.log('Patched india-admin.json and subdistricts.json.')
}

main().catch((err) => { console.error(err); process.exit(1) })
