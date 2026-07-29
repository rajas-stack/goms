// Rebuilds src/assets/districts/<stateCode>.json by dissolving the bundled
// taluka layer (src/assets/talukas/<stateCode>.json) up to district level,
// grouping by each taluka's parent district via src/data/subdistricts.json.
//
// Why not keep the previous files? They came from a 2011-census district layer
// whose `code` was a *census* district code (and was missing entirely for some
// states, e.g. Maharashtra). The app's hierarchy keys districts by their LGD
// code, so the two never joined — GeographyExplorer fell back to matching
// district *names*, which silently dropped every district whose transliteration
// differed ("Pashchim Champaran" vs "West Champaran") and every district
// created after 2011. Dissolving the taluka layer instead yields one feature
// per district carrying the real LGD `dt_code`, so the join is exact.
//
// Run: node scripts/dissolve-districts.cjs
const fs = require('fs')
const path = require('path')
const { robustUnionWithTimeout, dropSliverHoles } = require('./robust-union.cjs')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'districts')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

// District boundaries only ever render zoomed out to a whole state, so they can
// carry far fewer vertices than the taluka outlines they are built from. ~0.002
// degrees is roughly 200m — invisible at that zoom, and it keeps the dissolved
// output smaller than the per-state taluka file it came from.
const SIMPLIFY_TOLERANCE = 0.002

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
  } else {
    keep.add(hi)
  }
}

function simplifyRing(ring) {
  if (ring.length <= 5) return ring
  const open = ring.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, SIMPLIFY_TOLERANCE ** 2, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  // A ring needs >=4 positions (3 distinct + closure). Dissolved districts are
  // never slivers, so a collapse here means the tolerance ate a small island —
  // keep the original rather than emit a degenerate ring.
  return out.length >= 4 ? out : ring
}

function round(ring) {
  const out = []
  for (const [x, y] of ring) {
    const p = [Math.round(x * 10000) / 10000, Math.round(y * 10000) / 10000]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  if (out.length < 4) return ring
  // Re-close if rounding merged the closing point into its neighbour.
  const [f, l] = [out[0], out[out.length - 1]]
  if (f[0] !== l[0] || f[1] !== l[1]) out.push([f[0], f[1]])
  return out
}

/** Polygon/MultiPolygon -> polygon-clipping's MultiPolygon (array of polygons,
 *  each an array of rings). */
function toMulti(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/** Unions member geometries into one MultiPolygon via robustUnionWithTimeout
 *  (see robust-union.cjs) — a naive whole-shot union of a district's talukas
 *  reliably leaves sliver fragments behind (or throws) when their shared
 *  edges don't land on identical coordinates; the divide-and-conquer + repeat
 *  strategy there collapses those seams instead. Run in a worker with a
 *  timeout because a small number of source polygons put polygon-clipping
 *  into an unbounded-time worst case no amount of chunking avoids. */
async function dissolve(geometries, label) {
  const polys = geometries.flatMap(toMulti).filter((p) => p.length && p[0].length >= 4)
  if (polys.length === 0) return null
  if (polys.length === 1) return polys
  const before = polys.length
  const result = await robustUnionWithTimeout(polys)
  if (result.length > 1) {
    console.warn(`    ! ${label}: ${before} parts -> ${result.length} after union (some seams/self-intersections could not be merged)`)
  }
  return result
}

async function main() {
  const districtName = new Map()
  const stateOfDistrict = new Map()
  for (const st of admin) {
    for (const d of st.districts) {
      districtName.set(String(Number(d.dt_code)), d.district)
      stateOfDistrict.set(String(Number(d.dt_code)), Number(st.st_code))
    }
  }
  // taluka LGD code -> parent district LGD code
  const districtOfTaluka = new Map(
    subdistricts.map((s) => [String(Number(s.code)), String(Number(s.dtCode))]),
  )

  let totalOut = 0
  let totalMissing = 0
  const missingByState = []

  for (const st of admin) {
    const stateCode = Number(st.st_code)
    const talukaFile = path.join(TALUKA_DIR, `${stateCode}.json`)
    if (!fs.existsSync(talukaFile)) {
      console.warn(`  ! state ${stateCode} (${st.st_nm}): no taluka layer, skipped`)
      continue
    }
    const talukas = JSON.parse(fs.readFileSync(talukaFile, 'utf8'))

    // Group taluka geometries by parent district.
    const byDistrict = new Map()
    let orphans = 0
    for (const f of talukas.features) {
      const tCode = String(Number(f.properties.code))
      const dCode = districtOfTaluka.get(tCode)
      // A taluka polygon whose code isn't in the hierarchy can't be placed
      // under a district; counted and reported rather than guessed at.
      if (!dCode || stateOfDistrict.get(dCode) !== stateCode) { orphans++; continue }
      ;(byDistrict.get(dCode) ?? byDistrict.set(dCode, []).get(dCode)).push(f.geometry)
    }

    const features = []
    for (const [dCode, geoms] of byDistrict) {
      const name = districtName.get(dCode)
      const multi = await dissolve(geoms, `${st.st_nm}/${name}`)
      if (!multi) continue
      const rings = dropSliverHoles(multi).map((poly) => poly.map((r) => simplifyRing(round(r))))
      features.push({
        type: 'Feature',
        properties: { name, code: dCode },
        geometry: rings.length === 1
          ? { type: 'Polygon', coordinates: rings[0] }
          : { type: 'MultiPolygon', coordinates: rings },
      })
    }
    features.sort((a, b) => Number(a.properties.code) - Number(b.properties.code))

    fs.writeFileSync(
      path.join(OUT_DIR, `${stateCode}.json`),
      JSON.stringify({ type: 'FeatureCollection', features }),
    )

    const missing = st.districts.length - features.length
    totalOut += features.length
    totalMissing += Math.max(0, missing)
    if (missing > 0) missingByState.push(`${st.st_nm} (${missing}/${st.districts.length})`)
    console.log(
      `  ${String(stateCode).padStart(2)} ${st.st_nm.padEnd(42)} ${String(features.length).padStart(3)}/${String(st.districts.length).padEnd(3)} districts` +
      (orphans ? `  [${orphans} taluka polys with unknown code]` : ''),
    )
  }

  console.log(`\ndistricts written: ${totalOut}; still without a boundary: ${totalMissing}`)
  if (missingByState.length) console.log('  ' + missingByState.join(', '))
}

main().catch((err) => { console.error(err); process.exit(1) })
