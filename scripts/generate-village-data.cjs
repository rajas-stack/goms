// One-off conversion: state-wise village boundary shapefiles (zipped in the
// repo root, source: LGD village boundaries) -> per-taluka GeoJSON files
// under src/assets/villages/<stateCode>/<talukaCode>.json, mirroring the
// existing src/assets/talukas/<stateCode>.json pattern so Vite code-splits
// each taluka into its own on-demand chunk. Run once with `node
// scripts/generate-village-data.cjs`; re-run is idempotent (output dir is
// cleared first).
const fs = require('fs')
const path = require('path')
const os = require('os')
const { execFileSync } = require('child_process')
const shapefile = require('shapefile')
const proj4 = require('proj4')

const ROOT = path.join(__dirname, '..')
// Deliberately NOT src/assets/villages/ — that directory already holds
// villages.ts's flat [code, name] name-only fallback list, keyed directly by
// taluka code. This is the (much larger) polygon data keyed by state, then
// taluka, so the two never collide on disk or in either module's glob.
const OUT_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')
// The pre-existing name-only village list (villages.ts's fallback), keyed by
// taluka code → [villageLGDcode, name] pairs. ~10% of shapefile rows carry a
// blank Vill_name; this separate LGD snapshot names ~80% of those, joined by
// village LGD code, so we backfill from it before giving up on a name.
const NAMES_DIR = path.join(ROOT, 'src', 'assets', 'villages')

const fallbackNameCache = new Map()
function fallbackNames(talukaCode) {
  if (fallbackNameCache.has(talukaCode)) return fallbackNameCache.get(talukaCode)
  const file = path.join(NAMES_DIR, `${talukaCode}.json`)
  let map = null
  if (fs.existsSync(file)) {
    const arr = JSON.parse(fs.readFileSync(file, 'utf8'))
    map = new Map(arr.map(([code, name]) => [String(Number(code)), name]))
  }
  fallbackNameCache.set(talukaCode, map)
  return map
}

// Every source .prj is the same Lambert Conformal Conic (all-India LGD
// dataset) — WGS84 datum, so `.inverse()` goes straight to lon/lat.
const LCC = proj4(
  '+proj=lcc +lat_1=12.472944 +lat_2=35.172806 +lat_0=24 +lon_0=80 ' +
  '+x_0=4000000 +y_0=4000000 +ellps=WGS84 +units=m +no_defs',
)

// Field casing varies slightly between zips (`STATE_LGD` vs `State_LGD`,
// `Vill_cat` vs `Vill_Cat`) — read case-insensitively rather than trust one.
function prop(properties, name) {
  const key = Object.keys(properties).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? properties[key] : undefined
}

// The app keys states by their 2011-census code (india-admin.json's st_code /
// the map's st_code). The shapefiles carry the *LGD* state code in STATE_LGD,
// which is numeric and reliable and coincides with the census code for every
// state in this set EXCEPT Andhra Pradesh (LGD 28 → census 37) — keying by
// STATE_LGD verbatim filed all of AP under a "28" the app never looks up. So
// key by STATE_LGD with that one remap. (STATE_UT was tried instead but is
// unreliable: Chandigarh lacks the field entirely, Lakshadweep is
// "Lakshadweep-UT", DNH&DD spells "&" for "and".) Any row whose resulting
// code isn't a real hierarchy state — a blank/zero STATE_LGD or an unmapped
// LGD code — is skipped rather than misfiled.
const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const LGD_TO_CENSUS = { 28: 37 } // Andhra Pradesh
const validStateCodes = new Set(admin.map((s) => Number(s.st_code)))

// Ramer–Douglas–Peucker tolerance in degrees (~40m at these latitudes).
// Village outlines only ever render at taluka-or-tighter zoom in a ~190px
// pane, so survey-grade vertex density is invisible — dropping it is where
// nearly all the size savings come from. Shared borders between adjacent
// villages are simplified independently, so hairline gaps/overlaps can
// appear under extreme zoom; acceptable for this display-only use, and the
// bundled district/taluka boundaries are non-topological simplifications too.
const SIMPLIFY_TOLERANCE = 0.0004

function perpDist2([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax
  const dy = by - ay
  if (dx === 0 && dy === 0) return (px - ax) ** 2 + (py - ay) ** 2
  const t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
  const cx = ax + t * dx
  const cy = ay + t * dy
  return (px - cx) ** 2 + (py - cy) ** 2
}

/** RDP on an open point list (indices [lo, hi] inclusive kept). */
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
  if (ring.length <= 4) return ring
  // Treat the closed ring as an open list over its distinct vertices, then
  // re-close — RDP on a closed ring must pin both endpoints (the shared
  // first/last point) so the loop stays closed.
  const open = ring.slice(0, -1)
  const tol2 = SIMPLIFY_TOLERANCE ** 2
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, tol2, keep)
  keep.add(open.length - 1)
  const simplified = open.filter((_, i) => keep.has(i))
  simplified.push(simplified[0])
  // A polygon ring needs ≥4 positions (3 distinct + closure); if simplifying
  // collapsed it below that, keep the original rather than emit a degenerate.
  return simplified.length >= 4 ? simplified : ring
}

function projectRing(ring) {
  const out = []
  for (const [x, y] of ring) {
    const [lon, lat] = LCC.inverse([x, y])
    const rlon = Math.round(lon * 10000) / 10000
    const rlat = Math.round(lat * 10000) / 10000
    // Drop consecutive duplicate points left by rounding — same precision
    // (4dp) already used by the bundled taluka boundaries.
    const last = out[out.length - 1]
    if (!last || last[0] !== rlon || last[1] !== rlat) out.push([rlon, rlat])
  }
  return simplifyRing(out)
}

function projectGeometry(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.map(projectRing) }
  }
  if (geometry.type === 'MultiPolygon') {
    return { type: 'MultiPolygon', coordinates: geometry.coordinates.map((poly) => poly.map(projectRing)) }
  }
  return geometry
}

/** Flatten a (projected) Polygon/MultiPolygon into a list of individual
 *  polygons (each an array of rings), so parts of one village spread across
 *  rows can be concatenated regardless of which type each row carried. */
function polygonsOf(geometry) {
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

function findOne(dir, pattern) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findOne(full, pattern)
      if (found) return found
    } else if (pattern.test(entry.name)) {
      return full
    }
  }
  return null
}

async function convertOne(zipName) {
  const zipPath = path.join(ROOT, zipName)
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'village-shp-'))
  try {
    execFileSync('unzip', ['-oq', zipPath, '-d', tmpDir])
    const shpPath = findOne(tmpDir, /\.shp$/i)
    if (!shpPath) {
      console.warn(`  ! no .shp found in ${zipName}, skipping`)
      return
    }
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf')

    // taluka code -> { stateCode, villages: Map<villCode, { name, polygons: [] }> }.
    // A single village's boundary is sometimes stored across several shapefile
    // rows (detached parts), all sharing one Vill_LGD — accumulate their
    // polygon rings per village code and merge into one feature at write time,
    // so the output never has two features with the same code (which would
    // collide on React's `key` and drop parts of the village).
    const byTaluka = new Map()
    const source = await shapefile.open(shpPath, dbfPath)
    let result = await source.read()
    let count = 0
    let skipped = 0
    while (!result.done) {
      const { properties, geometry } = result.value
      const lgd = Number(prop(properties, 'STATE_LGD'))
      const censusCode = LGD_TO_CENSUS[lgd] ?? lgd
      const talukaCode = String(Number(prop(properties, 'Subdis_LGD')))
      const villCode = String(Number(prop(properties, 'Vill_LGD')))
      const villName = String(prop(properties, 'Vill_name') ?? '').trim()

      // Skip a row when either:
      //  - its state doesn't resolve to a real hierarchy state (a few strays
      //    with a blank STATE_LGD), or
      //  - its sub-district code is non-numeric (e.g. "00493N002"). Those are
      //    the newer alphanumeric LGD codes for sub-districts of districts
      //    created after this app's admin snapshot (e.g. Rajasthan's 2023
      //    "Kotputli-Behror") — the hierarchy has no node for them (every
      //    hierarchy taluka code is plain-numeric), so no drill-down can ever
      //    reach them and a file here would only be dead weight.
      if (!validStateCodes.has(censusCode) || talukaCode === 'NaN') {
        skipped++
        result = await source.read()
        continue
      }
      const stateCode = String(censusCode)

      const key = `${stateCode}/${talukaCode}`
      let bucket = byTaluka.get(key)
      if (!bucket) {
        bucket = { stateCode, talukaCode, villages: new Map() }
        byTaluka.set(key, bucket)
      }
      let village = bucket.villages.get(villCode)
      if (!village) {
        village = { name: villName, polygons: [] }
        bucket.villages.set(villCode, village)
      } else if (!village.name && villName) {
        // A later part of a multi-row village carried the name the first didn't.
        village.name = villName
      }
      village.polygons.push(...polygonsOf(projectGeometry(geometry)))

      count++
      result = await source.read()
    }

    for (const { stateCode, talukaCode, villages } of byTaluka.values()) {
      const names = fallbackNames(talukaCode)
      const features = [...villages.entries()].map(([code, { name, polygons }]) => ({
        type: 'Feature',
        properties: { name: name || names?.get(code) || 'Unnamed village', code },
        geometry: polygons.length === 1
          ? { type: 'Polygon', coordinates: polygons[0] }
          : { type: 'MultiPolygon', coordinates: polygons },
      }))
      const dir = path.join(OUT_DIR, stateCode)
      fs.mkdirSync(dir, { recursive: true })
      const file = path.join(dir, `${talukaCode}.json`)
      fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features }))
    }

    console.log(`  ${zipName}: ${count} villages -> ${byTaluka.size} talukas${skipped ? ` (${skipped} stray rows skipped)` : ''}`)
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main() {
  const filter = process.argv[2]
  let zips = fs.readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.zip'))
  if (filter) zips = zips.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
  // A filtered run only ever touches the talukas it actually (re)generates,
  // so wiping the whole output dir first would delete every other state's
  // already-converted data.
  if (!filter) fs.rmSync(OUT_DIR, { recursive: true, force: true })
  fs.mkdirSync(OUT_DIR, { recursive: true })
  console.log(`Converting ${zips.length} state archives...`)
  for (const zip of zips) {
    console.log(`- ${zip}`)
    await convertOne(zip)
  }
  console.log('Done.')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
