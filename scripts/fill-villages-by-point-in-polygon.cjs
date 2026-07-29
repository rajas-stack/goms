// Fills village-shape files by SPATIAL join instead of name matching, for
// source layers that carry no sub-district field at all — the SOI_Villages
// layer (Survey of India, via https://github.com/yashveeeeeeer/india-geodata,
// CC BY 4.0, release tag admin/villages) only has STATE/DISTRICT/VILLAGE, no
// tehsil — so there is nothing to name-match a taluka against. It does carry
// real village polygons though, and by this point in the pipeline most
// hierarchy talukas already have a boundary of their own (from
// build-geo-from-lgd.cjs / fill-gaps-from-national-lgd.cjs / SOI subdistrict
// fill), so each village can instead be placed by testing whether its point
// falls inside one of its district's ALREADY-RESOLVED taluka polygons.
//
// This is the main source of new village coverage for Himachal Pradesh from
// the SOI layer (~2400 villages). A second Bhuvan census-village layer
// (national, s_name/d_name/v_name fields — pass 'bhuvan' as the schema arg)
// additionally covers Meghalaya, Manipur, Mizoram, Nagaland and more of J&K
// and HP. Neither layer has any rows for Arunachal Pradesh or Ladakh — as of
// these datasets' vintage, village-level digitization for those two doesn't
// appear to exist publicly under either LGD or Bhuvan/SOI.
//
// Representative point per village: the arithmetic mean of its exterior
// ring's vertices. Not a true centroid (unweighted by area) and not
// guaranteed interior for a concave ring, but adequate given the boundaries
// themselves are already simplified for display, not survey use.
//
// Point-in-polygon: even-odd ray casting against the taluka's exterior ring(s)
// only (interior holes in a taluka boundary are not expected at this
// simplification level and are ignored). Candidates are restricted to talukas
// in the village's own (name-resolved) district, and to talukas that already
// have a polygon — this script places new villages onto existing taluka
// shapes, it does not invent new taluka boundaries.
//
// Never overwrites an existing village file.
//
// Run: node --max-old-space-size=8192 scripts/fill-villages-by-point-in-polygon.cjs <SOI_Villages.geojsonl>
const fs = require('fs')
const path = require('path')
const { readLines } = require('./linereader.cjs')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')
const VILLAGE_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')
const NAMES_DIR = path.join(ROOT, 'src', 'assets', 'villages')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const VILLAGE_TOLERANCE = 0.0004

const nd = (x) => String(x ?? '').toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')

function editDistance(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j)
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1)
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1] ? prev[j - 1] : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

// A source state name that's an outright rename ("Orissa" for Odisha) or
// carries an administrative prefix ("Union Territory of Jammu and Kashmir")
// won't hit an exact nd() match — these are the ones actually seen across the
// SOI/Bhuvan layers this script has been run against so far.
const STATE_ALIASES = {
  orissa: 'odisha',
  unionterritoryofjammuandkashmir: 'jammuandkashmir',
  unionterritoryofladakh: 'ladakh',
  jammukashmir: 'jammuandkashmir', // "JAMMU & KASHMIR" -> nd() drops "&" without an "and" to replace it
  andamannicobar: 'andamanandnicobarislands', // "ANDAMAN & NICOBAR" (no "Islands")
}
const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
function resolveAppStateCode(stname) {
  const n = nd(stname)
  const direct = appStateByName.get(n)
  if (direct != null) return direct
  const aliased = STATE_ALIASES[n]
  if (aliased) return appStateByName.get(aliased)
  return undefined
}

const districtsOf = new Map()
for (const st of admin) {
  const list = st.districts.map((d) => ({ normalised: nd(d.district), dtCode: String(Number(d.dt_code)) }))
  districtsOf.set(Number(st.st_code), list)
}
function resolveDistrict(stateCode, dtname) {
  const list = districtsOf.get(stateCode)
  if (!list) return undefined
  const n = nd(dtname)
  const exact = list.find((d) => d.normalised === n)
  if (exact) return exact.dtCode
  const near = list.filter((d) => d.normalised.length > 3 && (d.normalised.includes(n) || n.includes(d.normalised)))
  if (near.length === 1) return near[0].dtCode
  if (n.length > 3) {
    const budget = Math.max(2, Math.floor(n.length * 0.3))
    let best, bestDist = Infinity, tie = false
    for (const d of list) {
      if (Math.abs(d.normalised.length - n.length) > budget) continue
      const dist = editDistance(n, d.normalised)
      if (dist < bestDist) { bestDist = dist; best = d; tie = false }
      else if (dist === bestDist) tie = true
    }
    if (best && bestDist <= budget && !tie) return best.dtCode
  }
  return undefined
}

const talukasByDistrict = new Map()
for (const s of subdistricts) {
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
}

// ---- taluka polygon cache, per state, restricted to codes already present -

const talukaPolysCache = new Map() // stateCode -> Map<code, {bbox, rings: [[x,y],...][]}>
function loadTalukaPolys(stateCode) {
  if (talukaPolysCache.has(stateCode)) return talukaPolysCache.get(stateCode)
  const file = path.join(TALUKA_DIR, `${stateCode}.json`)
  const out = new Map()
  if (fs.existsSync(file)) {
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const f of fc.features) {
      const code = String(Number(f.properties.code))
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
        : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
        : []
      // Exterior ring of each polygon part only (index 0) — see header
      // comment. A ring must be an array of [x, y] pairs; a handful of
      // upstream taluka features (built by several different scripts across
      // this pipeline) turned out to have mismatched geometry-type/coordinate
      // depth — skip those defensively rather than let one bad taluka abort
      // the whole join.
      const rings = polys
        .map((poly) => poly[0])
        .filter((ring) => Array.isArray(ring) && ring.every((pt) => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number'))
      if (!rings.length) continue
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const ring of rings) {
        for (const [x, y] of ring) {
          if (x < minX) minX = x
          if (x > maxX) maxX = x
          if (y < minY) minY = y
          if (y > maxY) maxY = y
        }
      }
      out.set(code, { bbox: [minX, minY, maxX, maxY], rings })
    }
  }
  talukaPolysCache.set(stateCode, out)
  return out
}

function pointInRing([x, y], ring) {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    const intersects = (yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi
    if (intersects) inside = !inside
  }
  return inside
}
function pointInBbox([x, y], [minX, minY, maxX, maxY]) {
  return x >= minX && x <= maxX && y >= minY && y <= maxY
}

/** Finds which of this district's already-shaped talukas contains `point`. */
function findTalukaByPoint(stateCode, dtCode, point) {
  const polysByCode = loadTalukaPolys(stateCode)
  const candidates = talukasByDistrict.get(dtCode) ?? []
  for (const c of candidates) {
    const code = String(Number(c.code))
    const poly = polysByCode.get(code)
    if (!poly) continue
    if (!pointInBbox(point, poly.bbox)) continue
    for (const ring of poly.rings) {
      if (pointInRing(point, ring)) return c
    }
  }
  return undefined
}

// ---- geometry: representative point + simplification ---------------------

function meanPoint(ring) {
  let sx = 0, sy = 0
  for (const [x, y] of ring) { sx += x; sy += y }
  return [sx / ring.length, sy / ring.length]
}
function representativePoint(geometry) {
  const ring = geometry.type === 'Polygon' ? geometry.coordinates[0]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates[0]?.[0]
    : null
  return ring && ring.length ? meanPoint(ring) : null
}

function perpDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx, cy = ay + t * dy
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

function existingVillageCodes(stateCode) {
  const dir = path.join(VILLAGE_DIR, String(stateCode))
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir).map((f) => f.replace(/\.json$/, '')))
}

// Field-name mapping per source layer — the join logic (state/district
// resolution, point-in-polygon) is identical, only the property names differ.
const SCHEMAS = {
  soi: { state: (p) => p.STATE_C ?? p.STATE, district: (p) => p.DISTRICT_C ?? p.DISTRICT, village: (p) => p.VILLAGE_C ?? p.VILLAGE },
  bhuvan: { state: (p) => p.s_name, district: (p) => p.d_name, village: (p) => p.v_name },
  // bhuvan_panchayats has no village name at all (villages are grouped into
  // one GP polygon) — treat each Gram Panchayat as a single "village" entry.
  // Only useful where the village-level layer above had none, e.g. Arunachal
  // Pradesh (absent from bhuvan_villages, present here).
  'bhuvan-gp': { state: (p) => p.s_name, district: (p) => p.d_name, village: (p) => p.gp_name },
}

async function main() {
  const soiFile = process.argv[2]
  const schemaName = process.argv[3] ?? 'soi'
  const schema = SCHEMAS[schemaName]
  if (!soiFile || !schema) {
    console.error('usage: node scripts/fill-villages-by-point-in-polygon.cjs <geojsonl file> [soi|bhuvan]')
    process.exit(1)
  }

  let curState = null
  let already = new Set()
  const buckets = new Map() // talukaCode -> [{name, polys}]
  let features = 0
  let unresolvedState = 0
  let unresolvedDistrict = 0
  let unresolvedPoint = 0
  let placed = 0
  const touchedStates = new Set()

  const flushState = () => {
    if (curState == null || !buckets.size) { buckets.clear(); return }
    const dir = path.join(VILLAGE_DIR, String(curState))
    let written = 0
    for (const [talukaCode, villages] of buckets) {
      if (already.has(talukaCode)) continue
      const names = fallbackNames(talukaCode)
      const geoFeatures = villages.map(({ name, polys }, i) => ({
        type: 'Feature',
        properties: { name: name || names?.get(String(i)) || 'Unnamed village', code: `${schemaName}-${i}` },
        geometry: geomOf(polys),
      }))
      if (!geoFeatures.length) continue
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, `${talukaCode}.json`), JSON.stringify({ type: 'FeatureCollection', features: geoFeatures }))
      written++
    }
    if (written) {
      const st = admin.find((s) => Number(s.st_code) === curState)
      console.log(`  ${st?.st_nm ?? curState}: +${written} taluka village files (spatial join)`)
      touchedStates.add(st?.st_nm ?? String(curState))
    }
    buckets.clear()
  }

  for await (const line of readLines(soiFile, { onOversizedLine: () => {} })) {
    if (!line.trim()) continue
    features++
    let f
    try { f = JSON.parse(line) } catch { continue }
    const p = f.properties

    const stateCode = resolveAppStateCode(schema.state(p))
    if (stateCode == null) { unresolvedState++; continue }
    if (stateCode !== curState) { flushState(); curState = stateCode; already = existingVillageCodes(stateCode) }

    const dtCode = resolveDistrict(stateCode, schema.district(p))
    if (!dtCode) { unresolvedDistrict++; continue }

    const point = representativePoint(f.geometry)
    if (!point) continue
    const match = findTalukaByPoint(stateCode, dtCode, point)
    if (!match) { unresolvedPoint++; continue }

    const talukaCode = String(Number(match.code))
    if (already.has(talukaCode)) continue // that taluka's village file already exists — never overwrite
    const polys = simplifyGeometry(f.geometry)
    if (!polys.length) continue

    const name = String(schema.village(p) ?? '').trim()
    ;(buckets.get(talukaCode) ?? buckets.set(talukaCode, []).get(talukaCode)).push({ name, polys })
    placed++
  }
  flushState()

  console.log(
    `\n${features} source features: ${placed} placed by point-in-polygon across ${touchedStates.size} states, ` +
    `unresolved state ${unresolvedState} / district ${unresolvedDistrict} / no containing taluka ${unresolvedPoint}`,
  )
}

main()
