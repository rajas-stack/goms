// Fills the geography gaps for the 9 states/UTs that had no per-state village
// shapefile in the original set: Jammu & Kashmir, Ladakh, Himachal Pradesh,
// Assam, Arunachal Pradesh, Manipur, Meghalaya, Mizoram, Nagaland. Source is
// the india-geodata national LGD GeoJSONL dumps (already WGS84 lon/lat, so no
// reprojection — unlike the per-state shapefiles). Reads the (7z-extracted)
// LGD_Districts / LGD_Subdistricts / LGD_Villages .geojsonl files from a
// directory passed as argv[2].
//
//   node scripts/generate-missing-geo.cjs <dir-with-geojsonl>
//
// Writes, keyed by the app's 2011-census state code (joined by state NAME —
// the files' own state_lgd is a different code space):
//   - src/assets/districts/<code>.json  (only where absent — i.e. Ladakh)
//   - src/assets/talukas/<code>.json     (only where absent — i.e. Ladakh)
//   - src/assets/village-shapes/<code>/<talukaCode>.json  (all 9)
// matching the shapes the app already loads. Idempotent per state.
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const GEO_DIR = process.argv[2]
if (!GEO_DIR) { console.error('usage: node generate-missing-geo.cjs <dir-with-geojsonl>'); process.exit(1) }

const admin = require(path.join(ROOT, 'src/data/india-admin.json'))
// Join by state name: the GeoJSONL `state_lgd` is a different code space than
// the app's census st_code (e.g. its 38 is Daman/Diu, not Ladakh). Normalise
// "&"→"and", drop a trailing "islands", strip non-letters.
const normState = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '').replace(/islands$/, '')
const censusByName = new Map(admin.map((s) => [normState(s.st_nm), Number(s.st_code)]))

// The 9 gap states, by census code.
const TARGETS = new Set([1, 38, 2, 18, 12, 14, 17, 15, 13])

const prop = (p, ...names) => {
  for (const n of names) {
    const k = Object.keys(p).find((x) => x.toLowerCase() === n.toLowerCase())
    if (k != null && p[k] != null && String(p[k]).trim() !== '') return p[k]
  }
  return undefined
}

// --- geometry: round to 4dp + Ramer–Douglas–Peucker (same as the shapefile
// pipeline, minus the LCC reprojection since these are already lon/lat). ---
const TOL = 0.0004
function perp2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}
function rdp(pts, lo, hi, tol2, keep) {
  let md = 0, idx = -1
  for (let i = lo + 1; i < hi; i++) { const d = perp2(pts[i], pts[lo], pts[hi]); if (d > md) { md = d; idx = i } }
  if (md > tol2 && idx !== -1) { rdp(pts, lo, idx, tol2, keep); rdp(pts, idx, hi, tol2, keep) } else keep.add(hi)
}
function ring(coords) {
  const r = []
  for (const [lon, lat] of coords) {
    const x = Math.round(lon * 1e4) / 1e4, y = Math.round(lat * 1e4) / 1e4
    const last = r[r.length - 1]
    if (!last || last[0] !== x || last[1] !== y) r.push([x, y])
  }
  if (r.length <= 4) return r
  const open = r.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, TOL * TOL, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  return out.length >= 4 ? out : r
}
function simplify(geom) {
  if (geom.type === 'Polygon') return { type: 'Polygon', coordinates: geom.coordinates.map(ring) }
  if (geom.type === 'MultiPolygon') return { type: 'MultiPolygon', coordinates: geom.coordinates.map((p) => p.map(ring)) }
  return geom
}
function polygonsOf(geom) {
  if (geom.type === 'Polygon') return [geom.coordinates]
  if (geom.type === 'MultiPolygon') return geom.coordinates
  return []
}

function eachFeature(file, onFeature) {
  return new Promise((resolve, reject) => {
    const rl = readline.createInterface({ input: fs.createReadStream(path.join(GEO_DIR, file)) })
    rl.on('line', (line) => { if (line.trim()) { try { onFeature(JSON.parse(line)) } catch { /* skip bad line */ } } })
    rl.on('close', resolve)
    rl.on('error', reject)
  })
}

async function generateDistricts() {
  const wanted = [...TARGETS].filter((c) => !fs.existsSync(path.join(ROOT, 'src/assets/districts', `${c}.json`)))
  if (!wanted.length) { console.log('districts: nothing missing'); return }
  const byState = new Map(wanted.map((c) => [c, []]))
  await eachFeature('LGD_Districts.geojsonl', (f) => {
    const code = censusByName.get(normState(prop(f.properties, 'stname')))
    if (!byState.has(code)) return
    byState.get(code).push({ type: 'Feature', properties: { name: String(prop(f.properties, 'dtname') ?? '').trim() }, geometry: simplify(f.geometry) })
  })
  for (const [code, features] of byState) {
    fs.writeFileSync(path.join(ROOT, 'src/assets/districts', `${code}.json`), JSON.stringify({ type: 'FeatureCollection', features }))
    console.log(`  districts/${code}.json: ${features.length} districts`)
  }
}

async function generateTalukas() {
  const wanted = [...TARGETS].filter((c) => !fs.existsSync(path.join(ROOT, 'src/assets/talukas', `${c}.json`)))
  if (!wanted.length) { console.log('talukas: nothing missing'); return }
  const byState = new Map(wanted.map((c) => [c, new Map()])) // code -> Map(talukaCode -> {name, polys})
  await eachFeature('LGD_Subdistricts.geojsonl', (f) => {
    const code = censusByName.get(normState(prop(f.properties, 'stname')))
    if (!byState.has(code)) return
    const tc = String(Number(prop(f.properties, 'subdt_lgd')))
    if (tc === 'NaN') return
    const m = byState.get(code)
    let t = m.get(tc)
    if (!t) { t = { name: String(prop(f.properties, 'sdtname') ?? '').trim(), polys: [] }; m.set(tc, t) }
    t.polys.push(...polygonsOf(simplify(f.geometry)))
  })
  for (const [code, m] of byState) {
    const features = [...m.entries()].map(([tc, { name, polys }]) => ({
      type: 'Feature', properties: { name, code: tc },
      geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    }))
    fs.writeFileSync(path.join(ROOT, 'src/assets/talukas', `${code}.json`), JSON.stringify({ type: 'FeatureCollection', features }))
    console.log(`  talukas/${code}.json: ${features.length} talukas`)
  }
}

async function generateVillages() {
  // code -> Map(talukaCode -> Map(villCode -> {name, polys}))
  const byState = new Map([...TARGETS].map((c) => [c, new Map()]))
  let kept = 0, skipped = 0
  await eachFeature('LGD_Villages.geojsonl', (f) => {
    const code = censusByName.get(normState(prop(f.properties, 'stname')))
    if (!byState.has(code)) return
    const tc = String(Number(prop(f.properties, 'subdt_lgd')))
    const vc = String(Number(prop(f.properties, 'vil_lgd')))
    if (tc === 'NaN') { skipped++; return }
    const name = String(prop(f.properties, 'vilname11', 'vilnam_soi', 'vilname', 'villname', 'name') ?? '').trim()
    const talukas = byState.get(code)
    let vils = talukas.get(tc)
    if (!vils) { vils = new Map(); talukas.set(tc, vils) }
    let v = vils.get(vc)
    if (!v) { v = { name, polys: [] }; vils.set(vc, v) }
    else if (!v.name && name) v.name = name
    v.polys.push(...polygonsOf(simplify(f.geometry)))
    kept++
  })
  for (const [code, talukas] of byState) {
    if (!talukas.size) { console.log(`  village-shapes/${code}: (none in source)`); continue }
    const dir = path.join(ROOT, 'src/assets/village-shapes', String(code))
    fs.mkdirSync(dir, { recursive: true })
    for (const [tc, vils] of talukas) {
      const features = [...vils.entries()].map(([vc, { name, polys }]) => ({
        type: 'Feature', properties: { name: name || 'Unnamed village', code: vc },
        geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
      }))
      fs.writeFileSync(path.join(dir, `${tc}.json`), JSON.stringify({ type: 'FeatureCollection', features }))
    }
    console.log(`  village-shapes/${code}: ${talukas.size} talukas`)
  }
  console.log(`villages: ${kept} kept, ${skipped} skipped (non-numeric sub-district)`)
}

async function main() {
  console.log('Districts...'); await generateDistricts()
  console.log('Talukas...'); await generateTalukas()
  console.log('Villages...'); await generateVillages()
  console.log('Done.')
}
main().catch((e) => { console.error(e); process.exit(1) })
