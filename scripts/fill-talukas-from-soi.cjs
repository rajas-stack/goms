// Fills src/assets/talukas/<state>.json for hierarchy talukas still missing a
// polygon after build-geo-from-lgd.cjs and fill-gaps-from-national-lgd.cjs,
// using the Survey of India sub-district layer (SOI_Subdistricts, via
// https://github.com/yashveeeeeeer/india-geodata, CC BY 4.0, release tag
// admin/subdistricts). Never overwrites an existing polygon.
//
// Why a third source: the LGD-derived layers (build-geo-from-lgd.cjs's zips
// and the LGD_Subdistricts national layer) have thin-to-zero coverage of
// Himachal Pradesh, Jammu & Kashmir, Ladakh, Arunachal Pradesh, Nagaland,
// Manipur, Mizoram and Meghalaya — those states' village/tehsil-level LGD
// digitization is genuinely incomplete nationally, not a bug in this
// pipeline. SOI (the national topographic survey, which predates and is
// independent of LGD) has partial-to-good coverage of exactly these states.
//
// This layer carries no LGD codes at all (STATE/District/TEHSIL names only,
// occasionally in ALL CAPS with transliteration marks like "BILĀSPUR"), so the
// join is entirely by name: STATE -> hierarchy state, District -> hierarchy
// district (within that state), TEHSIL -> hierarchy taluka (within that
// district). Diacritics are stripped by the existing nd/nt normalisers before
// comparing.
//
// Run: node --max-old-space-size=6144 scripts/fill-talukas-from-soi.cjs <SOI_Subdistricts.geojsonl>
const fs = require('fs')
const path = require('path')
const { readLines } = require('./linereader.cjs')

const ROOT = path.join(__dirname, '..')
const TALUKA_DIR = path.join(ROOT, 'src', 'assets', 'talukas')

const admin = require(path.join(ROOT, 'src', 'data', 'india-admin.json'))
const subdistricts = require(path.join(ROOT, 'src', 'data', 'subdistricts.json'))

const TALUKA_TOLERANCE = 0.001

// Strips diacritics (e.g. "BILĀSPUR" -> "bilaspur") in addition to the usual
// punctuation/level-word normalisation, since this layer's names carry them.
const DIACRITIC_RE = new RegExp('[' + String.fromCharCode(768) + '-' + String.fromCharCode(879) + ']', 'g')
const stripDiacritics = (s) => s.normalize('NFD').replace(DIACRITIC_RE, '')
const nd = (x) => stripDiacritics(String(x ?? '')).toLowerCase().replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]/g, '')
const nt = (x) => stripDiacritics(String(x ?? ''))
  .toLowerCase()
  .replace(/\([^)]*\)/g, ' ')
  .replace(/\b(tehsil|tahsil|tahasil|taluka|taluk|mandal|circle|block|sub\s*division|subdivision|revenue|sadar)\b/g, ' ')
  .replace(/[^a-z0-9]/g, '')

/** Levenshtein edit distance, iterative single-row DP (no need for the full
 *  matrix or the backtrace, just the count). */
function editDistance(a, b) {
  if (a === b) return 0
  if (!a.length) return b.length
  if (!b.length) return a.length
  let prev = new Array(b.length + 1)
  for (let j = 0; j <= b.length; j++) prev[j] = j
  for (let i = 1; i <= a.length; i++) {
    const cur = new Array(b.length + 1)
    cur[0] = i
    for (let j = 1; j <= b.length; j++) {
      cur[j] = a[i - 1] === b[j - 1]
        ? prev[j - 1]
        : 1 + Math.min(prev[j - 1], prev[j], cur[j - 1])
    }
    prev = cur
  }
  return prev[b.length]
}

/** Picks the candidate whose normalised name is closest to `n` by edit
 *  distance, accepted only when: the distance is within budget (relative to
 *  name length — the SOI transliteration variance seen so far is a handful of
 *  vowel/consonant swaps, e.g. "Lahul" vs "Lahaul", "Ghurmwin" vs
 *  "Ghumarwin", not a different word), and no other candidate ties it — an
 *  ambiguous pair must never guess. */
function nearestByEditDistance(n, candidates, getNormalised) {
  if (n.length <= 3) return undefined
  const budget = Math.max(2, Math.floor(n.length * 0.3))
  let best, bestDist = Infinity, tie = false
  for (const c of candidates) {
    const cn = getNormalised(c)
    if (Math.abs(cn.length - n.length) > budget) continue
    const d = editDistance(n, cn)
    if (d < bestDist) { bestDist = d; best = c; tie = false }
    else if (d === bestDist) tie = true
  }
  return best !== undefined && bestDist <= budget && !tie ? best : undefined
}

const appStateByName = new Map(admin.map((s) => [nd(s.st_nm), Number(s.st_code)]))
// A source state name using "&" instead of "and" (e.g. "JAMMU & KASHMIR",
// "ANDAMAN & NICOBAR") won't hit an exact nd() match since nd() just strips
// the "&" rather than expanding it — these are the aliases actually seen so
// far across the LGD/SOI/Bhuvan layers this pipeline pulls from.
const STATE_ALIASES = {
  jammukashmir: 'jammuandkashmir',
  andamannicobar: 'andamanandnicobarislands',
}
function resolveAppStateCode(stname) {
  const n = nd(stname)
  return appStateByName.get(n) ?? (STATE_ALIASES[n] ? appStateByName.get(STATE_ALIASES[n]) : undefined)
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
  const fuzzy = nearestByEditDistance(n, list, (d) => d.normalised)
  return fuzzy?.dtCode
}

const talukasByDistrict = new Map()
for (const s of subdistricts) {
  const k = String(Number(s.dtCode))
  ;(talukasByDistrict.get(k) ?? talukasByDistrict.set(k, []).get(k)).push(s)
}
function resolveTaluka(dtCode, sdtname) {
  const candidates = talukasByDistrict.get(dtCode) ?? []
  const match = candidates.find((c) => nt(c.name) === nt(sdtname))
  if (match) return match
  const n = nt(sdtname)
  if (n.length <= 3) return undefined
  const near = candidates.filter((c) => {
    const cn = nt(c.name)
    return cn.length > 3 && (cn.includes(n) || n.includes(cn))
  })
  if (near.length === 1) return near[0]
  return nearestByEditDistance(n, candidates, (c) => nt(c.name))
}

// ---- geometry (same RDP simplifier as the sibling build scripts) ---------

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
  rdp(open, 0, open.length - 1, TALUKA_TOLERANCE ** 2, keep)
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
function combine(polyLists) {
  // polyLists is already an array of "poly" (each poly an array of rings) —
  // simplifyGeometry returns one entry per polygon part, already correctly
  // shaped. A `.flat()` here (an earlier bug, since fixed) stripped that
  // grouping down to a flat array of rings, so a single-ring result got
  // written as a bare ring for `coordinates` instead of the required
  // array-of-rings — a GeoJSON Polygon whose coordinates are one level too
  // shallow, which renders as a broken/degenerate shape.
  const polys = polyLists
  if (!polys.length) return null
  return polys.length === 1
    ? { type: 'Polygon', coordinates: polys[0] }
    : { type: 'MultiPolygon', coordinates: polys }
}

function existingCodes(stateCode) {
  const file = path.join(TALUKA_DIR, `${stateCode}.json`)
  if (!fs.existsSync(file)) return { file, features: [], codes: new Set() }
  const features = JSON.parse(fs.readFileSync(file, 'utf8')).features
  return { file, features, codes: new Set(features.map((f) => String(Number(f.properties.code)))) }
}

async function main() {
  const soiFile = process.argv[2]
  if (!soiFile) { console.error('usage: node scripts/fill-talukas-from-soi.cjs <SOI_Subdistricts.geojsonl>'); process.exit(1) }

  const layers = new Map()
  for (const st of admin) layers.set(Number(st.st_code), existingCodes(Number(st.st_code)))

  const pending = new Map() // `${stateCode}/${code}` -> { stateCode, code, name, polyLists }
  let features = 0
  let unresolvedState = 0
  let unresolvedDistrict = 0
  let unresolvedTaluka = 0
  let alreadyCovered = 0
  const sample = { state: [], district: [], taluka: [] }

  for await (const line of readLines(soiFile, {
    onOversizedLine: (len) => console.warn(`  ! skipped oversized line (${len} chars)`),
  })) {
    if (!line.trim()) continue
    features++
    let f
    try { f = JSON.parse(line) } catch { continue }
    const p = f.properties

    const stateCode = resolveAppStateCode(p.STATE)
    if (stateCode == null) {
      unresolvedState++
      if (sample.state.length < 15) sample.state.push(p.STATE)
      continue
    }
    const dtCode = resolveDistrict(stateCode, p.District)
    if (!dtCode) {
      unresolvedDistrict++
      if (sample.district.length < 15) sample.district.push(`${p.STATE}/${p.District}`)
      continue
    }
    const match = resolveTaluka(dtCode, p.TEHSIL)
    if (!match) {
      unresolvedTaluka++
      if (sample.taluka.length < 15) sample.taluka.push(`${p.STATE}/${p.District}/${p.TEHSIL}`)
      continue
    }
    const code = String(Number(match.code))
    const layer = layers.get(stateCode)
    if (layer.codes.has(code)) { alreadyCovered++; continue }

    const polys = simplifyGeometry(f.geometry)
    if (!polys.length) continue
    const key = `${stateCode}/${code}`
    const entry = pending.get(key)
    if (entry) entry.polyLists.push(...polys)
    else pending.set(key, { stateCode, code, name: match.name, polyLists: [...polys] })
  }

  const addedByState = new Map()
  for (const { stateCode, code, name, polyLists } of pending.values()) {
    const geometry = combine(polyLists)
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
  console.log(
    `\n${features} source features: ${total} talukas added, ${alreadyCovered} already had a polygon, ` +
    `unresolved state ${unresolvedState} / district ${unresolvedDistrict} / taluka ${unresolvedTaluka}`,
  )
  if (sample.state.length) console.log('  unresolved states e.g.:', [...new Set(sample.state)].join(', '))
  if (sample.district.length) console.log('  unresolved districts e.g.:', sample.district.join('; '))
  if (sample.taluka.length) console.log('  unresolved talukas e.g.:', sample.taluka.join('; '))
}

main()
