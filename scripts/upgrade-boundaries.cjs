// The bundled per-state district/taluka boundary files (src/assets/districts,
// src/assets/talukas — from the datta07/INDIAN-SHAPEFILES project) turned out
// badly incomplete for many states: e.g. Andhra Pradesh's district file only
// matched 0/13 hierarchy districts, its taluka file 0/310 talukas — those
// states could only ever render a flat tile grid, never a map, all the way
// down. The india-geodata national LGD_Districts/LGD_Subdistricts GeoJSONL
// dumps (the same source already used for the 9 states with zero taluka data)
// give equal-or-better hierarchy-match coverage almost everywhere.
//
// This replaces districts/<code>.json and talukas/<code>.json PER STATE,
// PER LEVEL, only where the LGD source's match count against the hierarchy is
// STRICTLY GREATER than the currently bundled file's — so it can only improve
// coverage, never regress a state that already had good data (e.g.
// Chhattisgarh's bundled taluka file already beats LGD there and is left
// alone). Run scripts/_check-district-coverage.cjs and
// _check-taluka-coverage.cjs first to see the comparison before trusting this
// blindly on a new geodata drop.
//
//   node scripts/upgrade-boundaries.cjs <dir-with-LGD_Districts-and-Subdistricts-geojsonl>
const fs = require('fs')
const path = require('path')
const readline = require('readline')

const ROOT = path.join(__dirname, '..')
const GEO_DIR = process.argv[2]
if (!GEO_DIR) { console.error('usage: node upgrade-boundaries.cjs <dir-with-geojsonl>'); process.exit(1) }

const admin = require(path.join(ROOT, 'src/data/india-admin.json'))
const subs = require(path.join(ROOT, 'src/data/subdistricts.json'))

const normState = (s) => String(s ?? '').toLowerCase().replace(/&/g, 'and').replace(/[^a-z]/g, '').replace(/islands$/, '')
const censusByName = new Map(admin.map((s) => [normState(s.st_nm), Number(s.st_code)]))
const normName = (s) => String(s ?? '').toLowerCase().replace(/[^a-z]/g, '')

const subsByState = {}
for (const s of subs) { const k = Number(s.stCode); (subsByState[k] ||= new Set()).add(String(Number(s.code))) }

// --- geometry: round 4dp + RDP simplify (source is already WGS84 lon/lat) ---
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
  const keep = new Set([0]); rdp(open, 0, open.length - 1, TOL * TOL, keep); keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i)); out.push(out[0])
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
    rl.on('line', (line) => { if (line.trim()) { try { onFeature(JSON.parse(line)) } catch { /* skip */ } } })
    rl.on('close', resolve); rl.on('error', reject)
  })
}

function matchCount(bundledFile, keyOf, hierKeys) {
  if (!fs.existsSync(bundledFile)) return 0
  const b = JSON.parse(fs.readFileSync(bundledFile, 'utf8'))
  const keys = new Set(b.features.map((f) => keyOf(f.properties)))
  return [...hierKeys].filter((k) => keys.has(k)).length
}

async function upgradeDistricts() {
  console.log('Districts:')
  const byState = new Map() // code -> [{name, geom}]
  await eachFeature('LGD_Districts.geojsonl', (f) => {
    const code = censusByName.get(normState(f.properties.stname))
    if (code == null) return
    ;(byState.get(code) || byState.set(code, []).get(code)).push({
      name: String(f.properties.dtname ?? '').trim(), geometry: simplify(f.geometry),
    })
  })
  for (const st of admin) {
    const code = Number(st.st_code)
    const lgdFeats = byState.get(code)
    if (!lgdFeats || !lgdFeats.length) continue
    const hierNames = new Set(st.districts.map((d) => normName(d.district)))
    const bundledFile = path.join(ROOT, 'src/assets/districts', `${code}.json`)
    const bundledMatch = matchCount(bundledFile, (p) => normName(p.name), hierNames)
    const lgdNames = new Set(lgdFeats.map((f) => normName(f.name)))
    const lgdMatch = [...hierNames].filter((n) => lgdNames.has(n)).length
    if (lgdMatch <= bundledMatch) continue
    const features = lgdFeats.map((f) => ({ type: 'Feature', properties: { name: f.name }, geometry: f.geometry }))
    fs.writeFileSync(bundledFile, JSON.stringify({ type: 'FeatureCollection', features }))
    console.log(`  ${st.st_nm} (${code}): ${bundledMatch} -> ${lgdMatch} / ${hierNames.size} matched`)
  }
}

async function upgradeTalukas() {
  console.log('Talukas:')
  const byState = new Map() // code -> Map(talukaCode -> {name, polys})
  await eachFeature('LGD_Subdistricts.geojsonl', (f) => {
    const code = censusByName.get(normState(f.properties.stname))
    if (code == null) return
    const tc = String(Number(f.properties.subdt_lgd))
    if (tc === 'NaN') return
    let m = byState.get(code)
    if (!m) { m = new Map(); byState.set(code, m) }
    let t = m.get(tc)
    if (!t) { t = { name: String(f.properties.sdtname ?? '').trim(), polys: [] }; m.set(tc, t) }
    t.polys.push(...polygonsOf(simplify(f.geometry)))
  })
  for (const st of admin) {
    const code = Number(st.st_code)
    const lgdTalukas = byState.get(code)
    if (!lgdTalukas || !lgdTalukas.size) continue
    const hierCodes = subsByState[code] || new Set()
    const bundledFile = path.join(ROOT, 'src/assets/talukas', `${code}.json`)
    const bundledMatch = matchCount(bundledFile, (p) => String(Number(p.code)), hierCodes)
    const lgdCodes = new Set(lgdTalukas.keys())
    const lgdMatch = [...hierCodes].filter((c) => lgdCodes.has(c)).length
    if (lgdMatch <= bundledMatch) continue
    const features = [...lgdTalukas.entries()].map(([tc, { name, polys }]) => ({
      type: 'Feature', properties: { name, code: tc },
      geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0] } : { type: 'MultiPolygon', coordinates: polys },
    }))
    fs.writeFileSync(bundledFile, JSON.stringify({ type: 'FeatureCollection', features }))
    console.log(`  ${st.st_nm} (${code}): ${bundledMatch} -> ${lgdMatch} / ${hierCodes.size} matched`)
  }
}

async function main() {
  await upgradeDistricts()
  await upgradeTalukas()
  console.log('Done.')
}
main().catch((e) => { console.error(e); process.exit(1) })
