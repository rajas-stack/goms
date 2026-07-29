// Fills the taluka and district boundary layers from the national LGD
// administrative boundary datasets, for every hierarchy node that still has no
// polygon after scripts/build-geo-from-lgd.cjs has run.
//
// Why a second source: the per-state LGD village shapefiles in the repo root
// only cover 27 states. Himachal Pradesh, Jammu & Kashmir, Ladakh, Arunachal
// Pradesh, Nagaland, Manipur, Mizoram and Meghalaya have no zip at all, and a
// few other states have districts the zips miss. This dataset is national.
//
// Source: https://github.com/yashveeeeeeer/india-geodata (CC BY 4.0), release
// tags `admin/subdistricts` and `admin/districts` -> LGD_Subdistricts.geojsonl
// and LGD_Districts.geojsonl. Already EPSG:4326 lon/lat, one Feature per line.
//
// Joining: this dataset's `dist_lgd`/`subdt_lgd` are a different LGD vintage
// from the app's hierarchy and collide numerically with other states' codes, so
// keying on them misfiles rows (verified: only 59 of 6405 talukas joined). The
// stable bridge is names, scoped by state: district name -> sub-district name.
// `state_lgd` is NOT used to find the state — verified it disagrees with the
// app's census `st_code` for three states (this dataset: 28=Andhra Pradesh,
// 37=Ladakh, 38=Dadra Nagar Haveli & Daman Diu; app: 37=Andhra Pradesh,
// 38=Ladakh, 26=DNH&DD). A blind numeric remap silently dropped every Ladakh
// and DNH&DD row (their real district names never matched the wrong state's
// district list, so they were skipped rather than misfiled — but skipped all
// the same). `stname` is matched by name instead, which is robust to this.
//
// Existing polygons are never overwritten — the village-derived outlines from
// build-geo-from-lgd.cjs are the newer and more detailed of the two. This only
// adds what is missing.
//
// Run: node --max-old-space-size=6144 scripts/fill-gaps-from-national-lgd.cjs <dataDir>
//   where <dataDir> holds sub/LGD_Subdistricts.geojsonl and dist/LGD_Districts.geojsonl
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')
const DISTRICT_DIR = path.join(ROOT, 'src', 'assets', 'districts')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))


// Taluka outlines render at district zoom, district outlines at state zoom, so
// both can shed a lot of vertices. ~0.001 deg is roughly 100m.
const TALUKA_TOLERANCE = 0.001
const DISTRICT_TOLERANCE = 0.002

const nd = (x) => String(x ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')
const nt = (x) => String(x ?? '')
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(tehsil|tahsil|tahasil|taluka|taluk|mandal|circle|block|sub\s*division|subdivision|revenue|sadar)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '')

// This dataset's `stname` -> app st_code, resolved by normalised name rather
// than by state_lgd (see header comment for why).
const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
// A source state name using "&" instead of "and" (e.g. "JAMMU & KASHMIR")
// won't hit an exact nd() match — see the identical fix/comment in
// fill-talukas-from-soi.cjs.
const STATE_ALIASES = {
  jammukashmir: 'jammuandkashmir',
  andamannicobar: 'andamanandnicobarislands',
}
function resolveAppStateCode(stname) {
  const n = nd(stname)
  return appStateByName.get(n) ?? (STATE_ALIASES[n] ? appStateByName.get(STATE_ALIASES[n]) : undefined)
}

// ---- geometry -------------------------------------------------------------

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
  let maxD = 0
  let idx = -1
  for (let i = lo + 1; i < hi; i++) {
    const d = perpDist2(points[i], points[lo], points[hi])
    if (d > maxD) { maxD = d; idx = i }
  }
  if (maxD > tol2 && idx !== -1) {
    rdp(points, lo, idx, tol2, keep)
    rdp(points, idx, hi, tol2, keep)
  } else keep.add(hi)
}

function simplifyRing(ring, tolerance) {
  const rounded = []
  for (const pt of ring) {
    const p = [Math.round(pt[0] * 10000) / 10000, Math.round(pt[1] * 10000) / 10000]
    const last = rounded[rounded.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) rounded.push(p)
  }
  if (rounded.length < 4) return null
  const f = rounded[0]
  const l = rounded[rounded.length - 1]
  if (f[0] !== l[0] || f[1] !== l[1]) rounded.push([f[0], f[1]])
  if (rounded.length <= 5) return rounded

  const open = rounded.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, tolerance ** 2, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  return out.length >= 4 ? out : rounded
}

function simplifyGeometry(geometry, tolerance) {
  const polys = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : []
  const out = []
  for (const poly of polys) {
    const rings = poly.map((r) => simplifyRing(r, tolerance)).filter(Boolean)
    if (rings.length) out.push(rings)
  }
  if (!out.length) return null
  return out.length === 1
    ? { type: 'Polygon', coordinates: out[0] }
    : { type: 'MultiPolygon', coordinates: out }
}

/** Concatenates the parts of one node spread over several source features into
 *  a single MultiPolygon. No union is attempted — these are separate features
 *  for the same administrative unit, so they do not share interior edges that
 *  would show as seams. */
function combine(geometries) {
  const polys = []
  for (const g of geometries) {
    if (!g) continue
    if (g.type === 'Polygon') polys.push(g.coordinates)
    else if (g.type === 'MultiPolygon') polys.push(...g.coordinates)
  }
  if (!polys.length) return null
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

// ---- indexes --------------------------------------------------------------

// app state code -> [{ name, normalised, dtCode }] (kept as a list, not just a
// name -> code Map, so resolveDistrict can fall back to a near-match).
const districtsOf = new Map()
// dtCode -> { name, stateCode }
const districtInfo = new Map()
for (const st of admin) {
  const list = []
  for (const d of st.districts) {
    const code = String(Number(d.dt_code))
    list.push({ name: d.district, normalised: nd(d.district), dtCode: code })
    districtInfo.set(code, { name: d.district, stateCode: Number(st.st_code) })
  }
  districtsOf.set(Number(st.st_code), list)
}
// dtCode -> hierarchy taluka nodes
const talukasByDistrict = new Map()
for (const s of subdistricts) {
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
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

function readLayer(file) {
  return readline.createInterface({ input: fs.createReadStream(file), crlfDelay: Infinity })
}

/** Existing feature codes per state, so we only ever add. */
function existingCodes(dir, stateCode) {
  const file = path.join(dir, `${stateCode}.json`)
  if (!fs.existsSync(file)) return { file, features: [], codes: new Set() }
  const features = JSON.parse(fs.readFileSync(file, 'utf8')).features
  return { file, features, codes: new Set(features.map((f) => String(Number(f.properties.code)))) }
}

// ---- taluka pass ----------------------------------------------------------

async function fillTalukas(subFile) {
  const layers = new Map() // stateCode -> { file, features, codes }
  for (const st of admin) layers.set(Number(st.st_code), existingCodes(TALUKA_DIR, Number(st.st_code)))

  // Accumulate geometry per resolved taluka code before writing, since one
  // taluka can appear as several features in the source layer.
  const pending = new Map() // `${stateCode}/${code}` -> { stateCode, code, name, geoms }
  let features = 0
  let unresolved = 0
  const unresolvedSample = []

  for await (const line of readLayer(subFile)) {
    if (!line.trim()) continue
    features++
    const f = JSON.parse(line)
    const p = f.properties
    const stateCode = resolveAppStateCode(p.stname)
    if (stateCode == null) { unresolved++; continue }
    const dtCode = resolveDistrict(stateCode, p.dtname)
    if (!dtCode) {
      unresolved++
      if (unresolvedSample.length < 25) unresolvedSample.push(`${p.stname}/${p.dtname} (district)`)
      continue
    }
    const candidates = talukasByDistrict.get(dtCode) ?? []
    let match = candidates.find((c) => nt(c.name) === nt(p.sdtname))
    if (!match) {
      // One normalised name containing the other, accepted only when a single
      // candidate qualifies so an ambiguous prefix never picks arbitrarily.
      const n = nt(p.sdtname)
      const near = candidates.filter((c) => {
        const cn = nt(c.name)
        return cn.length > 3 && n.length > 3 && (cn.includes(n) || n.includes(cn))
      })
      if (near.length === 1) match = near[0]
    }
    if (!match) {
      unresolved++
      if (unresolvedSample.length < 25) unresolvedSample.push(`${p.stname}/${p.dtname}/${p.sdtname}`)
      continue
    }
    const code = String(Number(match.code))
    const layer = layers.get(stateCode)
    // Already has a (better, village-derived) outline — leave it alone.
    if (!layer || layer.codes.has(code)) continue
    const geom = simplifyGeometry(f.geometry, TALUKA_TOLERANCE)
    if (!geom) continue
    const key = `${stateCode}/${code}`
    const entry = pending.get(key)
    if (entry) entry.geoms.push(geom)
    else pending.set(key, { stateCode, code, name: match.name, geoms: [geom] })
  }

  const addedByState = new Map()
  for (const { stateCode, code, name, geoms } of pending.values()) {
    const geometry = combine(geoms)
    if (!geometry) continue
    const layer = layers.get(stateCode)
    layer.features.push({ type: 'Feature', properties: { name, code }, geometry })
    layer.codes.add(code)
    addedByState.set(stateCode, (addedByState.get(stateCode) ?? 0) + 1)
  }

  for (const [stateCode, added] of addedByState) {
    const layer = layers.get(stateCode)
    layer.features.sort((a, b) => Number(a.properties.code) - Number(b.properties.code))
    fs.writeFileSync(layer.file, JSON.stringify({ type: 'FeatureCollection', features: layer.features }))
    const st = admin.find((s) => Number(s.st_code) === stateCode)
    console.log(`  + ${String(added).padStart(4)} taluka outlines  ${st.st_nm}`)
  }

  const total = [...addedByState.values()].reduce((a, b) => a + b, 0)
  console.log(`\ntalukas: ${features} source features, ${total} added, ${unresolved} source features unresolved`)
  if (unresolvedSample.length) console.log('  unresolved e.g.: ' + unresolvedSample.slice(0, 12).join('; '))
  return total
}

// ---- district pass -------------------------------------------------------

async function fillDistricts(distFile) {
  const layers = new Map()
  for (const st of admin) layers.set(Number(st.st_code), existingCodes(DISTRICT_DIR, Number(st.st_code)))

  const pending = new Map()
  let features = 0
  let unresolved = 0

  for await (const line of readLayer(distFile)) {
    if (!line.trim()) continue
    features++
    const f = JSON.parse(line)
    const p = f.properties
    const stateCode = resolveAppStateCode(p.stname)
    if (stateCode == null) { unresolved++; continue }
    const dtCode = resolveDistrict(stateCode, p.dtname)
    if (!dtCode) { unresolved++; continue }
    const layer = layers.get(stateCode)
    if (!layer || layer.codes.has(dtCode)) continue
    const geom = simplifyGeometry(f.geometry, DISTRICT_TOLERANCE)
    if (!geom) continue
    const key = `${stateCode}/${dtCode}`
    const entry = pending.get(key)
    if (entry) entry.geoms.push(geom)
    else pending.set(key, { stateCode, code: dtCode, name: districtInfo.get(dtCode).name, geoms: [geom] })
  }

  const addedByState = new Map()
  for (const { stateCode, code, name, geoms } of pending.values()) {
    const geometry = combine(geoms)
    if (!geometry) continue
    const layer = layers.get(stateCode)
    layer.features.push({ type: 'Feature', properties: { name, code }, geometry })
    layer.codes.add(code)
    addedByState.set(stateCode, (addedByState.get(stateCode) ?? 0) + 1)
  }

  for (const [stateCode, added] of addedByState) {
    const layer = layers.get(stateCode)
    layer.features.sort((a, b) => Number(a.properties.code) - Number(b.properties.code))
    fs.writeFileSync(layer.file, JSON.stringify({ type: 'FeatureCollection', features: layer.features }))
    const st = admin.find((s) => Number(s.st_code) === stateCode)
    console.log(`  + ${String(added).padStart(3)} district outlines  ${st.st_nm}`)
  }

  const total = [...addedByState.values()].reduce((a, b) => a + b, 0)
  console.log(`\ndistricts: ${features} source features, ${total} added, ${unresolved} source features unresolved`)
  return total
}

async function main() {
  const dataDir = process.argv[2]
  if (!dataDir) { console.error('usage: node scripts/fill-gaps-from-national-lgd.cjs <dataDir>'); process.exit(1) }
  const subFile = path.join(dataDir, 'sub', 'LGD_Subdistricts.geojsonl')
  const distFile = path.join(dataDir, 'dist', 'LGD_Districts.geojsonl')

  if (fs.existsSync(subFile)) {
    console.log('--- talukas ---')
    await fillTalukas(subFile)
  } else console.warn(`! missing ${subFile}`)

  if (fs.existsSync(distFile)) {
    console.log('\n--- districts ---')
    await fillDistricts(distFile)
  } else console.warn(`! missing ${distFile}`)
}

main()
