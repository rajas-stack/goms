// Fills village-shape files for Jammu and Kashmir from the Bhuvan census
// village layer (Bhuvan_JK_Villages, via
// https://github.com/yashveeeeeeer/india-geodata, CC BY 4.0, release tag
// admin/villages). Never overwrites an existing village file.
//
// Why this source: neither the LGD subdistrict/village layers nor SOI cover
// J&K's village level at all. This ISRO/Bhuvan layer does (~6,600 villages),
// but it's pre-2019 J&K (before the Ladakh split and before J&K's own
// district reorganisation created districts like Kulgam, Shopian, Bandipora,
// Ganderbal, Samba, Kishtwar, Ramban, Reasi), and it carries no sub-district
// name at all (DID/TID are Bhuvan's own internal codes, not LGD). So:
//  - District: resolved by fuzzy name match (DIST_NAME "Badgam" -> app's
//    "Budgam", "Punch" -> "Poonch", etc.) against whichever CURRENT district
//    contains that old district's territory.
//  - Taluka: resolved by point-in-polygon against that district's
//    already-shaped talukas (from build-geo-from-lgd.cjs /
//    fill-gaps-from-national-lgd.cjs / fill-talukas-from-soi.cjs) — same
//    technique as fill-villages-by-point-in-polygon.cjs, needed here for the
//    same reason: no sub-district field to name-match against.
//
// A village whose point falls in a post-2006 district this old layer
// couldn't have known about (Kulgam etc., split out of Anantnag/Pulwama/
// Baramulla after this layer's vintage) still resolves correctly, since
// resolution is spatial against the CURRENT taluka shapes, not by the old
// DIST_NAME's boundary.
//
// Run: node --max-old-space-size=4096 scripts/fill-jk-villages-from-bhuvan.cjs <Bhuvan_JK_Villages.geojsonl>
const fs = require('fs')
const path = require('path')
const { readLines } = require('./linereader.cjs')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')
const VILLAGE_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const JK_STATE_CODE = Number(admin.find((s) => s.st_nm === 'Jammu and Kashmir').st_code)
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

const jkDistricts = admin
  .find((s) => s.st_nm === 'Jammu and Kashmir')
  .districts.map((d) => ({ normalised: nd(d.district), dtCode: String(Number(d.dt_code)) }))

function resolveDistrict(dtname) {
  const n = nd(dtname)
  const exact = jkDistricts.find((d) => d.normalised === n)
  if (exact) return exact.dtCode
  const near = jkDistricts.filter((d) => d.normalised.length > 3 && (d.normalised.includes(n) || n.includes(d.normalised)))
  if (near.length === 1) return near[0].dtCode
  if (n.length > 3) {
    const budget = Math.max(2, Math.floor(n.length * 0.35))
    let best, bestDist = Infinity, tie = false
    for (const d of jkDistricts) {
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
  if (Number(s.stCode) !== JK_STATE_CODE) continue
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
}

// ---- taluka polygon cache (same approach as fill-villages-by-point-in-polygon.cjs) --

let talukaPolys = null
function loadTalukaPolys() {
  if (talukaPolys) return talukaPolys
  const file = path.join(TALUKA_DIR, `${JK_STATE_CODE}.json`)
  const out = new Map()
  if (fs.existsSync(file)) {
    const fc = JSON.parse(fs.readFileSync(file, 'utf8'))
    for (const f of fc.features) {
      const code = String(Number(f.properties.code))
      const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates]
        : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates
        : []
      const rings = polys
        .map((poly) => poly[0])
        .filter((ring) => Array.isArray(ring) && ring.every((pt) => Array.isArray(pt) && pt.length === 2 && typeof pt[0] === 'number'))
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
      for (const ring of rings) for (const [x, y] of ring) {
        if (x < minX) minX = x; if (x > maxX) maxX = x
        if (y < minY) minY = y; if (y > maxY) maxY = y
      }
      out.set(code, { bbox: [minX, minY, maxX, maxY], rings })
    }
  }
  talukaPolys = out
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
function findTalukaByPoint(dtCode, point) {
  const polysByCode = loadTalukaPolys()
  const candidates = talukasByDistrict.get(dtCode) ?? []
  for (const c of candidates) {
    const poly = polysByCode.get(String(Number(c.code)))
    if (!poly) continue
    const [x, y] = point
    if (x < poly.bbox[0] || x > poly.bbox[2] || y < poly.bbox[1] || y > poly.bbox[3]) continue
    for (const ring of poly.rings) if (pointInRing(point, ring)) return c
  }
  return undefined
}

// ---- geometry --------------------------------------------------------------

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

function existingVillageCodes() {
  const dir = path.join(VILLAGE_DIR, String(JK_STATE_CODE))
  if (!fs.existsSync(dir)) return new Set()
  return new Set(fs.readdirSync(dir).map((f) => f.replace(/\.json$/, '')))
}

async function main() {
  const soiFile = process.argv[2]
  if (!soiFile) { console.error('usage: node scripts/fill-jk-villages-from-bhuvan.cjs <Bhuvan_JK_Villages.geojsonl>'); process.exit(1) }

  const already = existingVillageCodes()
  const buckets = new Map() // talukaCode -> [{name, polys}]
  let features = 0, unresolvedDistrict = 0, unresolvedPoint = 0, placed = 0

  for await (const line of readLines(soiFile, { onOversizedLine: () => {} })) {
    if (!line.trim()) continue
    features++
    let f
    try { f = JSON.parse(line) } catch { continue }
    const p = f.properties
    if (nd(p.STAT_NAME) !== 'jk') continue // this file also carries a couple of stray non-JK rows

    const dtCode = resolveDistrict(p.DIST_NAME)
    if (!dtCode) { unresolvedDistrict++; continue }

    const point = representativePoint(f.geometry)
    if (!point) continue
    const match = findTalukaByPoint(dtCode, point)
    if (!match) { unresolvedPoint++; continue }

    const talukaCode = String(Number(match.code))
    if (already.has(talukaCode)) continue

    const polys = simplifyGeometry(f.geometry)
    if (!polys.length) continue
    const name = String(p.NAME ?? '').trim()
    ;(buckets.get(talukaCode) ?? buckets.set(talukaCode, []).get(talukaCode)).push({ name, polys })
    placed++
  }

  const dir = path.join(VILLAGE_DIR, String(JK_STATE_CODE))
  let written = 0
  for (const [talukaCode, villages] of buckets) {
    if (already.has(talukaCode)) continue
    const geoFeatures = villages.map(({ name, polys }, i) => ({
      type: 'Feature',
      properties: { name: name || 'Unnamed village', code: `bhuvan-${i}` },
      geometry: geomOf(polys),
    }))
    if (!geoFeatures.length) continue
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(path.join(dir, `${talukaCode}.json`), JSON.stringify({ type: 'FeatureCollection', features: geoFeatures }))
    written++
  }

  console.log(
    `${features} source features: ${written} taluka village files written (${placed} villages placed), ` +
    `unresolved district ${unresolvedDistrict} / no containing taluka ${unresolvedPoint}`,
  )
}

main()
