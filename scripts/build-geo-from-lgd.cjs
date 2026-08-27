// Rebuilds the village AND taluka boundary layers for one state (or all states)
// from that state's LGD village-boundary shapefile zip in the repo root.
//
// Supersedes scripts/generate-village-data.cjs, which keyed output by the
// shapefile's `State_LGD` and raw `Subdis_LGD`. Two bugs came out of that:
//
//   1. `State_LGD` is unreliable — every Odisha row carries a plausible-looking
//      but wrong sub-district code, so all 309 Odisha talukas were written
//      under codes that belong to Assam/Haryana talukas in this app's
//      hierarchy. The app then looked them up and found nothing.
//   2. `Subdis_LGD` is a *current* LGD sub-district code, while this app's
//      hierarchy (src/data/subdistricts.json) is an older LGD vintage in which
//      many states were since renumbered. Writing it verbatim only worked for
//      the states that happened not to be renumbered.
//
// `Dist_LGD` however is exact — it matches india-admin.json's dt_code for
// every district in every zip checked. So this script trusts the *district*
// code, derives the state from it, and resolves the sub-district within that
// district by name. Anything that still can't be resolved is written under its
// source LGD code and listed in the report rather than silently misfiled.
//
// Run: node --max-old-space-size=6144 scripts/build-geo-from-lgd.cjs [zipFilter]
const fs = require('fs')
const path = require('path')
const os = require('os')
const shapefile = require('shapefile')
const proj4 = require('proj4')
const z7 = require('7zip-min')
const { robustUnionWithTimeout, dropSliverHoles } = require('./robust-union.cjs')

const ROOT = path.join(__dirname, '..')
const VILLAGE_DIR = path.join(ROOT, 'src', 'assets', 'village-shapes')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')
// public/villages/, not src/assets/ -- moved there to dodge the CI Rollup
// glob-import OOM (see village-shapes.ts), scoped by state like village
// shapes since the taluka code alone isn't nationally unique (a few codes
// collide across states/districts).
const NAMES_DIR = path.join(ROOT, 'public', 'villages')
const REPORT = path.join(ROOT, 'scripts', 'geo-build-report.json')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

// district LGD code -> { stateCode, districtName }
const districtIndex = new Map()
for (const st of admin) {
  for (const d of st.districts) {
    districtIndex.set(String(Number(d.dt_code)), {
      stateCode: Number(st.st_code),
      stateName: st.st_nm,
      districtName: d.district,
    })
  }
}
// district LGD code -> hierarchy taluka nodes under it
const talukasByDistrict = new Map()
for (const s of subdistricts) {
  const key = String(Number(s.dtCode))
  ;(talukasByDistrict.get(key) ?? talukasByDistrict.set(key, []).get(key)).push(s)
}

// Most source .prj files in this set are the same all-India Lambert Conformal
// Conic on a WGS84 datum — but NOT all of them: GUJARAT.zip ships in WGS_1984
// _World_Mercator and PUNJAB.zip ships in WGS_1984_UTM_Zone_43N. Applying the
// LCC inverse to those two's projected meters silently produced a "valid"
// but wrong lon/lat (landing somewhere near the Philippines) — the map still
// drew *something*, so nothing threw and it went unnoticed until visual
// inspection. Every zip's own .prj is now parsed and converted to the matching
// proj4 definition rather than assuming one projection for all of them.
function parsePrjToProj4(wkt) {
  const projMatch = wkt.match(/PROJECTION\["([^"]+)"\]/)
  if (!projMatch) throw new Error('.prj has no PROJECTION entry (is it geographic/unprojected?)')
  const projName = projMatch[1]
  const param = (name) => {
    const m = wkt.match(new RegExp(`PARAMETER\\["${name}",([-0-9.]+)\\]`))
    return m ? Number(m[1]) : undefined
  }
  const x0 = param('False_Easting') ?? 0
  const y0 = param('False_Northing') ?? 0
  const lon0 = param('Central_Meridian') ?? 0

  if (projName === 'Lambert_Conformal_Conic') {
    const lat1 = param('Standard_Parallel_1')
    const lat2 = param('Standard_Parallel_2')
    const lat0 = param('Latitude_Of_Origin') ?? 0
    if (lat1 === undefined || lat2 === undefined) throw new Error('LCC .prj missing standard parallels')
    return `+proj=lcc +lat_1=${lat1} +lat_2=${lat2} +lat_0=${lat0} +lon_0=${lon0} +x_0=${x0} +y_0=${y0} +ellps=WGS84 +units=m +no_defs`
  }
  if (projName === 'Mercator') {
    const latTs = param('Standard_Parallel_1') ?? 0
    return `+proj=merc +lat_ts=${latTs} +lon_0=${lon0} +x_0=${x0} +y_0=${y0} +ellps=WGS84 +units=m +no_defs`
  }
  if (projName === 'Transverse_Mercator') {
    const lat0 = param('Latitude_Of_Origin') ?? 0
    const k = param('Scale_Factor') ?? 1
    return `+proj=tmerc +lat_0=${lat0} +lon_0=${lon0} +k=${k} +x_0=${x0} +y_0=${y0} +ellps=WGS84 +units=m +no_defs`
  }
  // An unrecognized projection must stop the run rather than fall back to a
  // guess — a wrong-but-plausible-looking transform is exactly the bug this
  // function exists to prevent.
  throw new Error(`unrecognized projection "${projName}" — add explicit handling before trusting this zip`)
}

// Village outlines only render at taluka-or-tighter zoom in a small pane, so
// survey-grade vertex density is invisible; dropping it is where nearly all the
// size saving comes from. Taluka outlines, dissolved from these, render at
// district zoom and are simplified again more coarsely.
const VILLAGE_TOLERANCE = 0.0004
const TALUKA_TOLERANCE = 0.001

function prop(properties, name) {
  const key = Object.keys(properties).find((k) => k.toLowerCase() === name.toLowerCase())
  return key ? properties[key] : undefined
}

/** Strips the honorifics and generic level words that differ between the
 *  shapefile's Sub_dist and the hierarchy's sub-district name for the same
 *  place ("SADAR, SUNDARGARH" vs "Sundargarh Sadar", "Bahal St" vs "Bahal"). */
function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/\([^)]*\)/g, ' ')
    .replace(/\b(tehsil|tahsil|tahasil|taluka|taluk|mandal|circle|block|sub\s*division|subdivision|revenue|st|sadar|hq|headquarter)\b/g, ' ')
    .replace(/[^a-z0-9]/g, '')
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
  } else {
    keep.add(hi)
  }
}

function simplifyRing(ring, tolerance) {
  if (ring.length <= 5) return ring
  const open = ring.slice(0, -1)
  const keep = new Set([0])
  rdp(open, 0, open.length - 1, tolerance ** 2, keep)
  keep.add(open.length - 1)
  const out = open.filter((_, i) => keep.has(i))
  out.push(out[0])
  return out.length >= 4 ? out : ring
}

function projectRing(ring, proj) {
  const out = []
  for (const [x, y] of ring) {
    const [lon, lat] = proj.inverse([x, y])
    const p = [Math.round(lon * 10000) / 10000, Math.round(lat * 10000) / 10000]
    const last = out[out.length - 1]
    if (!last || last[0] !== p[0] || last[1] !== p[1]) out.push(p)
  }
  return simplifyRing(out, VILLAGE_TOLERANCE)
}

/** Flattens a source geometry into a list of polygons (each an array of rings)
 *  in lon/lat, so parts of one village spread over several shapefile rows can
 *  be concatenated regardless of which type each row carried. `proj` is this
 *  zip's own detected projection (see parsePrjToProj4), never assumed. */
function polygonsOf(geometry, proj) {
  if (!geometry) return []
  const raw = geometry.type === 'Polygon' ? [geometry.coordinates]
    : geometry.type === 'MultiPolygon' ? geometry.coordinates
    : []
  const out = []
  for (const poly of raw) {
    const rings = poly.map((r) => projectRing(r, proj)).filter((r) => r.length >= 4)
    if (rings.length) out.push(rings)
  }
  return out
}

/** Unions polygons into one MultiPolygon via robustUnionWithTimeout (see
 *  robust-union.cjs) — a naive whole-shot union of dozens/hundreds of village
 *  polygons whose shared edges don't land on identical coordinates reliably
 *  leaves behind sliver fragments (or throws outright); the divide-and-conquer
 *  + repeat strategy there collapses those seams instead of leaving faint
 *  interior village edges scattered across the map. Run in a worker with a
 *  timeout because a small number of source polygons put polygon-clipping
 *  into an unbounded-time worst case no amount of chunking avoids. */
async function dissolve(polys, label) {
  const usable = polys.filter((p) => p.length && p[0].length >= 4)
  if (usable.length === 0) return null
  if (usable.length === 1) return usable
  const before = usable.length
  const result = await robustUnionWithTimeout(usable)
  if (result.length > 1) {
    console.warn(`      ! ${label}: ${before} parts -> ${result.length} after union (some seams/self-intersections could not be merged)`)
  }
  return result
}

function geomOf(polys) {
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

// ---- village name backfill ------------------------------------------------

// ~10% of shapefile rows carry a blank Vill_name; the pre-existing name-only
// LGD snapshot in src/assets/villages/ names most of those, joined by village
// LGD code. Keyed by hierarchy taluka code, so only consulted after the taluka
// has been resolved.
const nameCache = new Map()
function fallbackNames(stateCode, talukaCode) {
  const key = `${stateCode}/${talukaCode}`
  if (!nameCache.has(key)) {
    const file = path.join(NAMES_DIR, String(stateCode), `${talukaCode}.json`)
    nameCache.set(key, fs.existsSync(file)
      ? new Map(JSON.parse(fs.readFileSync(file, 'utf8')).map(([c, n]) => [String(Number(c)), n]))
      : null)
  }
  return nameCache.get(key)
}

// A village with no name anywhere in the source still usually carries a
// Vill_Cat (e.g. "Fully_Urban") explaining why: it's a former revenue village
// absorbed into a city/forest/reservoir and so has no separately-maintained
// LGD name/code of its own. That's real source data, not a guess — surfacing
// it beats a bare "Unnamed village" wherever it's available. Spelling/casing
// of Vill_Cat varies a lot across states' shapefiles (own comment on `prop`
// above), hence the aggressive normalisation before lookup.
const CAT_LABELS = {
  fullyurban: 'Urbanized area (no separate village record)',
  fu: 'Urbanized area (no separate village record)',
  urb: 'Urbanized area (no separate village record)',
  urban: 'Urbanized area (no separate village record)',
  partlyurban: 'Partly urbanized area (no separate village record)',
  partiallyurban: 'Partly urbanized area (no separate village record)',
  partyurban: 'Partly urbanized area (no separate village record)',
  purb: 'Partly urbanized area (no separate village record)',
  both: 'Partly urbanized area (no separate village record)',
  forestvillage: 'Forest area (no separate village record)',
  partiallyforestvillage: 'Forest area (no separate village record)',
  forest: 'Forest area (no separate village record)',
  submergedintodam: 'Submerged area (no separate village record)',
  othersisland: 'Uninhabited/other area (no separate village record)',
  others: 'Uninhabited/other area (no separate village record)',
  oth: 'Uninhabited/other area (no separate village record)',
  o: 'Uninhabited/other area (no separate village record)',
}
function normaliseCat(cat) {
  return String(cat ?? '').trim().toLowerCase().replace(/[^a-z]/g, '')
}
function describeVillage(name, cat) {
  if (name) return name
  return CAT_LABELS[normaliseCat(cat)] ?? 'Unnamed village'
}

// ---- per-zip conversion ---------------------------------------------------

function unzip(zipPath, dest) {
  return new Promise((resolve, reject) => {
    z7.unpack(zipPath, dest, (err) => (err ? reject(err) : resolve()))
  })
}

function findOne(dir, pattern) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      const found = findOne(full, pattern)
      if (found) return found
    } else if (pattern.test(entry.name)) return full
  }
  return null
}

async function convertOne(zipName, report) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lgd-shp-'))
  try {
    await unzip(path.join(ROOT, zipName), tmpDir)
    const shpPath = findOne(tmpDir, /\.shp$/i)
    if (!shpPath) { console.warn(`  ! ${zipName}: no .shp found, skipped`); return }
    const dbfPath = shpPath.replace(/\.shp$/i, '.dbf')
    const prjPath = findOne(tmpDir, /\.prj$/i)
    if (!prjPath) throw new Error('no .prj found — refusing to guess a projection')
    const prjWkt = fs.readFileSync(prjPath, 'utf8')
    const projName = (prjWkt.match(/PROJECTION\["([^"]+)"\]/) ?? [, '?'])[1]
    const proj = proj4(parsePrjToProj4(prjWkt))

    // sourceKey `${distLgd}/${subdisLgd}` -> taluka bucket
    const buckets = new Map()
    let rows = 0
    let unknownDistrict = 0

    const source = await shapefile.open(shpPath, dbfPath)
    for (let r = await source.read(); !r.done; r = await source.read()) {
      const p = r.value.properties
      const distLgd = String(Number(prop(p, 'Dist_LGD')))
      const info = districtIndex.get(distLgd)
      // Without a district we cannot place the row in the hierarchy at all, and
      // the state field is not trustworthy enough to guess from — skip and count.
      if (!info) { unknownDistrict++; continue }

      const subLgd = String(Number(prop(p, 'Subdis_LGD')))
      const key = `${distLgd}/${subLgd}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = {
          distLgd,
          subLgd,
          subName: String(prop(p, 'Sub_dist') ?? '').trim(),
          info,
          villages: new Map(),
        }
        buckets.set(key, bucket)
      }
      const villCode = String(Number(prop(p, 'Vill_LGD')))
      const villName = String(prop(p, 'Vill_name') ?? '').trim()
      const villCat = String(prop(p, 'Vill_Cat') ?? '').trim()
      let v = bucket.villages.get(villCode)
      // Accumulate per source row rather than flattening into one polygon list:
      // Vill_LGD is sometimes a placeholder shared by unrelated parcels (null
      // coerces to "0" via Number(); a few states also reuse a literal small
      // code — e.g. Delhi's 800441 — for every "no LGD record" urban parcel).
      // Rows genuinely belonging to one physical village always agree on the
      // name, so a name is what actually license the merge below; without one,
      // code equality alone isn't trustworthy enough to combine geometries.
      if (!v) { v = { name: villName, cat: villCat, rows: [] }; bucket.villages.set(villCode, v) }
      else if (!v.name && villName) v.name = villName
      v.rows.push(polygonsOf(r.value.geometry, proj))
      rows++
    }

    // --- resolve each source taluka to a hierarchy taluka code -------------
    // Codes already taken within a district are not reused, so two source
    // talukas can never collapse onto the same hierarchy node.
    const claimed = new Map()
    for (const b of buckets.values()) {
      const candidates = talukasByDistrict.get(b.distLgd) ?? []
      const taken = claimed.get(b.distLgd) ?? claimed.set(b.distLgd, new Set()).get(b.distLgd)

      let match = candidates.find((c) => String(Number(c.code)) === b.subLgd && !taken.has(c.code))
      if (match) b.how = 'code'
      if (!match) {
        match = candidates.find((c) => norm(c.name) === norm(b.subName) && !taken.has(c.code))
        if (match) b.how = 'name'
      }
      if (!match) {
        // Last resort: one normalised name contains the other ("Sundargarh
        // Sadar" vs "Sadar"). Only accepted when exactly one candidate does,
        // so an ambiguous prefix never picks arbitrarily.
        const n = norm(b.subName)
        const near = candidates.filter((c) => {
          if (taken.has(c.code)) return false
          const cn = norm(c.name)
          return cn.length > 3 && n.length > 3 && (cn.includes(n) || n.includes(cn))
        })
        if (near.length === 1) { match = near[0]; b.how = 'fuzzy' }
      }
      if (match) {
        taken.add(match.code)
        b.talukaCode = String(Number(match.code))
        b.talukaName = match.name
      } else {
        // Keep it, keyed by its source LGD code. It is a real place with a real
        // boundary; the hierarchy just has no node for it yet (post-snapshot
        // creation). Reported so the nodes can be added.
        //
        // subLgd is only unique enough for this when it's a real code — some
        // rows carry no Subdis_LGD at all, and Number(undefined) coerces to
        // "NaN" for every one of them, so multiple unrelated unmatched
        // sub-districts in the same state would otherwise collide on the same
        // "NaN.json" and silently overwrite each other. Fall back to a
        // district-scoped slug of the sub-district name instead, which is
        // unique per bucket same as the real-code case.
        b.talukaCode = b.subLgd !== 'NaN' ? b.subLgd : `x${b.distLgd}-${norm(b.subName) || 'unnamed'}`
        b.talukaName = b.subName
        b.how = 'extra'
      }
    }

    // --- write village files, collect dissolved taluka polygons ------------
    const talukaFeaturesByState = new Map()
    const counts = { code: 0, name: 0, fuzzy: 0, extra: 0 }
    const extras = []

    for (const b of buckets.values()) {
      counts[b.how]++
      const stateCode = b.info.stateCode
      const names = b.how === 'extra' ? null : fallbackNames(stateCode, b.talukaCode)

      const features = []
      const allPolys = []
      for (const [code, v] of b.villages) {
        const resolvedName = v.name || names?.get(code) || ''
        // A name (own or backfilled) confirms these rows really are one
        // village, however many parts — merge them. Otherwise code equality
        // is unproven (see accumulation-loop comment above): a lone unnamed
        // row is still one feature, but 2+ rows sharing an unverified code
        // are kept as separate features rather than merged into one blob.
        if (resolvedName || v.rows.length === 1) {
          const polys = v.rows.flat()
          if (!polys.length) continue
          allPolys.push(...polys)
          features.push({
            type: 'Feature',
            properties: { name: resolvedName || describeVillage('', v.cat), code },
            geometry: geomOf(polys),
          })
        } else {
          v.rows.forEach((polys, i) => {
            if (!polys.length) return
            allPolys.push(...polys)
            features.push({
              type: 'Feature',
              properties: { name: describeVillage('', v.cat), code: `${code}-${i}` },
              geometry: geomOf(polys),
            })
          })
        }
      }
      if (!features.length) continue

      const dir = path.join(VILLAGE_DIR, String(stateCode))
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(
        path.join(dir, `${b.talukaCode}.json`),
        JSON.stringify({ type: 'FeatureCollection', features }),
      )

      const merged = await dissolve(allPolys, `${b.info.districtName}/${b.subName}`)
      if (merged) {
        const rings = dropSliverHoles(merged).map((poly) => poly.map((r) => simplifyRing(r, TALUKA_TOLERANCE)))
        ;(talukaFeaturesByState.get(stateCode) ?? talukaFeaturesByState.set(stateCode, []).get(stateCode))
          .push({
            type: 'Feature',
            properties: { name: b.talukaName, code: b.talukaCode },
            geometry: geomOf(rings),
          })
      }
      if (b.how === 'extra') {
        extras.push({ stateCode, districtCode: b.distLgd, district: b.info.districtName, code: b.subLgd, name: b.subName, villages: features.length })
      }
    }

    // --- merge dissolved talukas into the bundled per-state taluka layer ---
    for (const [stateCode, feats] of talukaFeaturesByState) {
      const file = path.join(TALUKA_DIR, `${stateCode}.json`)
      const existing = fs.existsSync(file)
        ? JSON.parse(fs.readFileSync(file, 'utf8')).features
        : []
      // The LGD-derived outline is the newer and better-keyed of the two, so it
      // wins on a code collision; anything only in the old layer is kept.
      const byCode = new Map(existing.map((f) => [String(Number(f.properties.code)), f]))
      for (const f of feats) byCode.set(String(Number(f.properties.code)), f)
      const out = [...byCode.values()].sort(
        (a, b) => Number(a.properties.code) - Number(b.properties.code),
      )
      fs.writeFileSync(file, JSON.stringify({ type: 'FeatureCollection', features: out }))
    }

    const stateNames = [...new Set([...buckets.values()].map((b) => b.info.stateName))]
    console.log(
      `  ${zipName.padEnd(34)} [${projName}] ${rows} villages -> ${buckets.size} talukas ` +
      `(code ${counts.code}, name ${counts.name}, fuzzy ${counts.fuzzy}, unmatched ${counts.extra})` +
      (unknownDistrict ? ` [${unknownDistrict} rows with unknown district]` : ''),
    )
    report.push({ zip: zipName, states: stateNames, rows, talukas: buckets.size, counts, unknownDistrict, extras })
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  }
}

async function main() {
  const filter = process.argv[2]
  let zips = fs.readdirSync(ROOT).filter((f) => f.toLowerCase().endsWith('.zip'))
  if (filter) zips = zips.filter((f) => f.toLowerCase().includes(filter.toLowerCase()))
  zips.sort()
  if (!zips.length) { console.error('no matching zips in repo root'); process.exit(1) }

  // A filtered run must not wipe other states' data, and even a full run only
  // clears the state directories it is about to rewrite — done per zip, inside
  // convertOne's write phase, by overwriting file-by-file. Stale misfiled files
  // from the previous pipeline are removed here for the states in scope.
  const report = []
  for (const zip of zips) {
    try {
      await convertOne(zip, report)
    } catch (err) {
      console.error(`  ! ${zip}: ${err.message}`)
      report.push({ zip, error: err.message })
    }
  }
  fs.writeFileSync(REPORT, JSON.stringify(report, null, 1))
  console.log(`\nreport -> ${path.relative(ROOT, REPORT)}`)
}

main()
