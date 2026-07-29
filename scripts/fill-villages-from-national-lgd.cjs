// Fills src/assets/village-shapes/<state>/<taluka>.json for every hierarchy
// taluka that still has no village file after scripts/build-geo-from-lgd.cjs
// (the per-state zips in the repo root only cover 27 states — Himachal
// Pradesh, Jammu & Kashmir, Ladakh, Arunachal Pradesh, Nagaland, Manipur,
// Mizoram and Meghalaya have no zip, and a few other states' zips miss
// districts). Source: the national LGD_Villages layer from
// https://github.com/yashveeeeeeer/india-geodata (CC BY 4.0, release tag
// admin/villages), ~585k features, one Feature per line, already lon/lat.
//
// Joining follows the same reasoning as fill-gaps-from-national-lgd.cjs: this
// dataset's LGD codes are a different vintage from the app's hierarchy, so
// they're used only as a same-district disambiguator, not the primary key —
// the primary key is district name -> sub-district name, scoped by state. The
// state itself is resolved from `stname` by name, NOT from `state_lgd` — that
// field disagrees with the app's census `st_code` for Ladakh and DNH&DD in
// this same publisher's subdistrict/district layers (confirmed the village
// layer shares the same numbering), so a numeric remap would silently drop
// both states' rows again.
//
// Rows are (almost) contiguous by state_lgd in the source file — verified: 71
// contiguous runs covering 35 states — so this streams and flushes each
// state's buckets to disk as soon as the state_lgd changes, rather than
// holding all ~585k features (many with vertex-heavy polygons) in memory at
// once.
//
// Existing village files are never touched.
//
// Run: node --max-old-space-size=8192 scripts/fill-villages-from-national-lgd.cjs <villagesGeojsonl>
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const VILLAGE_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')
const NAMES_DIR = path.join(ROOT, 'src', 'assets', 'villages')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const VILLAGE_TOLERANCE = 0.0004

const nd = (x) => String(x ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')
const nt = (x) => String(x ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(tehsil|tahsil|tahasil|taluka|taluk|mandal|circle|block|sub\s*division|subdivision|revenue|sadar)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '')

// This dataset's `stname` -> app st_code, resolved by name (see header comment).
const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
function resolveAppStateCode(stname) {
  return appStateByName.get(nd(stname))
}

// ---- geometry (same RDP simplifier as the other build scripts) -----------

function perpDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}
function rdp(points, lo, hi, tol2, keep) {
  let maxD = 0, idx = -1
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist2(points[i], points[lo], points[hi])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > tol2 && idx !== -1) { rdp(points, lo, idx, tol2, keep); rdp(points, idx, hi, tol2, keep) }
  else keep.add(hi)
}
function simplifyRing(ring) {
  const rounded = []
  for (const pt of ring) {
    const p = [Math.round(pt[0] * 10000) / 10000, Math.round(pt[1] * 10000) / 10000]
    const last = rounded[rounded.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p)
  }
  if (rounded.length < 4) return null
  const f = rounded[0], l = rounded[rounded.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) rounded.push([f[0], f[1]])
  if (rounded.length <= 5) return rounded
  const open = rounded.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, VILLAGE_TOLERANCE ** 2, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  return out.length >= 4 ? out : rounded
}
function simplifyGeometry(geometry) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : []
  const out = []
  for (const poly of polys) {
    const rings = poly.map(simplifyRing).filter(Boolean)
    if (rings.length) out.push(rings)
  }
  return out
}
function geomOf(polys) {
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

// ---- indexes ---------------------------------------------------------------

// app stateCode -> [{ normalised, dtCode }], kept as a list (not just a
// name -> code Map) so resolveDistrict can fall back to a near-match.
const districtsOf = new Map()
for (const st of admin) {
  const list = st.districts.map((d) => ({ normalised: nd(d.district), dtCode: String(Number(d.dt_code)) }))
  districtsOf.set(Number(st.st_code), list)
}

/** Resolves a source district name to this state's hierarchy district code.
 *  Exact normalised-name match first; failing that, a name that embeds the
 *  other in full (handles a source name carrying the state as a suffix, e.g.
 *  "Leh Ladakh" for the app's "Leh"), accepted only when exactly one district
 *  in the state qualifies so an ambiguous prefix never guesses. */
function resolveDistrict(stateCode, dtname) {
  const list = districtsOf.get(stateCode)
  if (!list) return undefined
  const n = nd(dtname)
  const exact = list.find((d) => d.normalised === n)
  if (exact) return exact.dtCode
  if (n.length > 3) {
    const near = list.filter((d) => d.normalised.length > 3 && (d.normalised.includes(n) || n.includes(d.normalised)))
    if (near.length === 1) return near[0].dtCode
  }
  return undefined
}

const talukasByDistrict = new Map() // dtCode -> hierarchy taluka nodes
for (const s of subdistricts) {
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
}

function existingVillageCodes(stateCode) {
  const dir = path.join(VILLAGE_DIR, String(stateCode))
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir).map((f) => f.replace(/\.json$/, '')))
}

const nameCache = new Map()
function fallbackNames(talukaCode) {
  if (!nameCache.has(talukaCode)) {
    const file = path.join(NAMES_DIR, `${talukaCode}.json`)
    nameCache.set(talukaCode, fs.existsSync(file)
      ? new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(([c, n]) => [String(Number(c)), n]))
      : null)
  }
  return nameCache.get(talukaCode)
}

// Resolves a source (dtname, sdtname) pair to a hierarchy taluka node, caching
// per district so repeated villages in the same taluka are nearly free.
const resolveCache = new Map() // `${stateCode}/${dtname}/${sdtname}` -> code | null
function resolveTaluka(stateCode, dtname, sdtname) {
  const key = `${stateCode}/${dtname}/${sdtname}`
  if (resolveCache.has(key)) return resolveCache.get(key)
  const dtCode = resolveDistrict(stateCode, dtname)
  let result = null
  if (dtCode) {
    const candidates = talukasByDistrict.get(dtCode) ?? []
    let match = candidates.find((c) => nt(c.name) === nt(sdtname))
    if (!match) {
      const n = nt(sdtname)
      const near = candidates.filter((c) => {
        const cn = nt(c.name)
        return cn.length > 3 && n.length > 3 && (cn.includes(n) || n.includes(cn))
      })
      if (near.length === 1) match = near[0]
    }
    if (match) result = String(Number(match.code))
  }
  resolveCache.set(key, result)
  return result
}

// ---- per-state-run flush ----------------------------------------------------

function flushState(stateCode, buckets) {
  if (!buckets.size) return { written: 0, villages: 0 }
  const already = existingVillageCodes(stateCode)
  let written = 0
  let villages = 0
  const dir = path.join(VILLAGE_DIR, String(stateCode))
  for (const [talukaCode, villageMap] of buckets) {
    if (already.has(talukaCode)) continue // keep the existing (village-derived) file
    const names = fallbackNames(talukaCode)
    const features = []
    for (const [code, v] of villageMap) {
      const resolvedName = v.name || names?.get(code) || ''
      if (resolvedName || v.rows.length === 1) {
        const polys = v.rows.flat()
        if (!polys.length) continue
        features.push({
          type: 'Feature',
          properties: { name: resolvedName || 'Unnamed village', code },
          geometry: geomOf(polys),
        })
      } else {
        v.rows.forEach((polys, i) => {
          if (!polys.length) return
          features.push({
            type: 'Feature',
            properties: { name: 'Unnamed village', code: `${code}-${i}` },
            geometry: geomOf(polys),
          })
        })
      }
    }
    if (!features.length) continue
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${talukaCode}.json`), JSON.stringify({ type: 'FeatureCollection', features }))
    written++
    villages += features.length
  }
  return { written, villages }
}

async function main() {
  const villagesFile = process.argv[2]
  if (!villagesFile) { console.error('usage: node scripts/fill-villages-from-national-lgd.cjs <villagesGeojsonl>'); process.exit(1) }

  const rl = readline.createInterface({ input: fs.createReadStream(villagesFile), crlfDelay: Infinity })

  let curState = null
  let curRawGroup = null
  let buckets = new Map() // talukaCode -> Map<villCode, {name, polys}>
  let totalWritten = 0
  let totalVillages = 0
  let totalRows = 0
  let unresolved = 0
  const statesTouched = []

  const flush = () => {
    if (curState == null) return
    const { written, villages } = flushState(curState, buckets)
    if (written) {
      const st = admin.find((s) => Number(s.st_code) === curState)
      console.log(`  ${String(curState).padStart(2)} ${(st?.st_nm ?? '?').padEnd(30)} +${written} taluka village files (${villages} villages)`)
      totalWritten += written
      totalVillages += villages
      statesTouched.push(st?.st_nm ?? String(curState))
    }
    buckets = new Map()
  }

  for await (const line of rl) {
    if (!line.trim()) continue
    totalRows++
    const p = JSON.parse(line)
    const props = p.properties
    // Grouped by the source file's own state_lgd purely to detect when to
    // flush (rows are contiguous runs of it) — the actual app state code used
    // for every lookup and write below always comes from resolveAppStateCode.
    const rawGroup = Number(props.state_lgd)
    if (rawGroup !== curRawGroup) { flush(); curRawGroup = rawGroup; curState = resolveAppStateCode(props.stname) }

    if (curState == null) { unresolved++; continue }
    const stateCode = curState
    const talukaCode = resolveTaluka(stateCode, props.dtname, props.sdtname)
    if (!talukaCode) { unresolved++; continue }

    const villCode = String(Number(props.vil_lgd))
    const villName = String(props.vilnam_soi ?? props.vilname11 ?? '').trim()
    const polys = simplifyGeometry(p.geometry)
    if (!polys.length) continue

    let bucket = buckets.get(talukaCode)
    if (!bucket) { bucket = new Map(); buckets.set(talukaCode, bucket) }
    let v = bucket.get(villCode)
    // Rows accumulate per source row (not flattened) because vil_lgd is
    // sometimes a placeholder shared by unrelated parcels (a blank/null value
    // coerces to "0" via Number()) — see build-geo-from-lgd.cjs's identical
    // comment. A name is what actually license merging two rows into one
    // village; without one, sharing a code isn't enough evidence on its own.
    if (!v) { v = { name: villName, rows: [] }; bucket.set(villCode, v) }
    else if (!v.name && villName) v.name = villName
    v.rows.push(polys)

    if (totalRows % 100000 === 0) console.log(`  ...${totalRows} rows read`)
  }
  flush()

  console.log(
    `\nrows ${totalRows}, unresolved ${unresolved}, taluka village files written ${totalWritten} ` +
    `(${totalVillages} villages) across ${new Set(statesTouched).size} states`,
  )
}

main()
